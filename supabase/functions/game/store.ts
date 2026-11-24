// @ts-nocheck
// Supabase-backed storage for the game API (service role: bypasses RLS, never exposed to browsers).
export function makeStore(sb) {
  const one = async (q) => { const { data, error } = await q; if (error) throw error; return data; };
  const num = (r, ...keys) => { for (const k of keys) if (r[k] != null) r[k] = Number(r[k]); return r; };
  return {
    // owner stats
    bump: async (k) => { await sb.rpc("bump_stat", { k }); },
    statCounts: (from) => one(sb.from("stat_counts").select("day,key,n").gte("day", from).limit(5000)),
    async statPeople(fromISO) {
      const [prof, games, daily, ranked] = await Promise.all([
        sb.from("profiles").select("created_at", { count: "exact" }).gte("created_at", fromISO).limit(20000),
        sb.from("games").select("user_id,created_at").not("user_id", "is", null).gte("created_at", fromISO).limit(50000),
        sb.from("daily_results").select("play_date", { count: "exact" }).gte("play_date", fromISO.slice(0, 10)).limit(50000),
        sb.from("ranked_stats").select("user_id", { count: "exact", head: true }),
      ]);
      const total = await sb.from("profiles").select("id", { count: "exact", head: true });
      for (const r of [prof, games, daily, ranked, total]) if (r.error) throw r.error;
      return { signups: prof.data, games: games.data, daily: daily.data, rankedPlayers: ranked.count || 0, accounts: total.count || 0 };
    },
    getProfile: (id) => one(sb.from("profiles").select("*").eq("id", id).maybeSingle()),
    // exact username, any case (usernames are letters, numbers and _, and _ is a wildcard in ilike, so escape it)
    findProfileByName: (name) => /^[A-Za-z0-9_]{3,16}$/.test(name)
      ? one(sb.from("profiles").select("id,username").ilike("username", name.replace(/_/g, "\\_")).maybeSingle()) : null,
    async createProfile(id, username) {
      const { error } = await sb.from("profiles").insert({ id, username });
      if (error?.code === "23505") return false; // username taken
      if (error) throw error;
      return true;
    },
    // anonymous casual/challenge games are throwaway; prune ones older than 2 days so the free database stays small
    cleanupCasual: async () => { await sb.from("games").delete().is("user_id", null).lt("created_at", new Date(Date.now() - 2 * 864e5).toISOString()); },
    getGame: (id) => one(sb.from("games").select("*").eq("id", id).maybeSingle()),
    // live matches. saveMatch only writes if nobody else saved since we read it; returns false if they did.
    getMatch: (id) => one(sb.from("matches").select("*").eq("id", id).maybeSingle()),
    insertMatch: (m) => one(sb.from("matches").insert(m).select().single()),
    async saveMatch(m) {
      const { data, error } = await sb.from("matches").update({ status: m.status, state: m.state, version: m.version + 1, updated_at: new Date().toISOString() })
        .eq("id", m.id).eq("version", m.version).select("id").maybeSingle();
      if (error) throw error;
      if (data) m.version += 1;
      return !!data;
    },
    cleanupMatches: async () => { await sb.from("matches").delete().lt("created_at", new Date(Date.now() - 3 * 864e5).toISOString()); },
    async findGame(where) {
      let q = sb.from("games").select("*");
      for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      return one(q.order("created_at", { ascending: false }).limit(1).maybeSingle());
    },
    insertGame: (g) => one(sb.from("games").insert(g).select().single()),
    // give a logged-out game to an account, only if nobody owns it yet. Returns true when it worked.
    claimGame: async (id, uid) => !!(await sb.from("games").update({ user_id: uid }).eq("id", id).is("user_id", null).select("id").maybeSingle()).data,
    updateGame: (g) => one(sb.from("games").update({ status: g.status, state: g.state, updated_at: new Date().toISOString() }).eq("id", g.id).select("id").single()),

    getDaily: (date, uid) => one(sb.from("daily_results").select("total,pct,grid,picks,late").eq("play_date", date).eq("user_id", uid).maybeSingle()),
    putDaily: (row) => one(sb.from("daily_results").upsert(row)),
    async dailyDates(uid) { return (await one(sb.from("daily_results").select("play_date").eq("user_id", uid).eq("late", false).order("play_date", { ascending: false }).limit(400))).map((r) => r.play_date); },
    async dailyHistory(uid, n) { return (await one(sb.from("daily_results").select("play_date,total,pct,grid,late").eq("user_id", uid).order("play_date", { ascending: false }).limit(n))).map((r) => num(r, "total", "pct")); },
    getRanked: (uid) => one(sb.from("ranked_stats").select("*").eq("user_id", uid).maybeSingle()),
    putRanked: (row) => one(sb.from("ranked_stats").upsert(row)),
    getBest: (uid) => one(sb.from("best_lineups").select("total").eq("user_id", uid).maybeSingle()),
    async getBestFull(uid) { const r = await one(sb.from("best_lineups").select("total,pct,mode,lineup,finished_at").eq("user_id", uid).maybeSingle()); return r && num(r, "total", "pct"); },
    putBest: (row) => one(sb.from("best_lineups").upsert({ ...row, finished_at: new Date().toISOString() })),
    // every finished Daily for a date (for stats). Capped; aggregate in SQL if the game gets huge.
    async dailyAll(date) { return (await one(sb.from("daily_results").select("user_id,total,pct,grid,picks").eq("play_date", date).limit(20000))).map((r) => num(r, "total", "pct")); },
    async dailyCounts(dates) {
      if (!dates.length) return {};
      const rows = await one(sb.from("daily_results").select("play_date").in("play_date", dates).limit(100000));
      return rows.reduce((m, r) => ((m[r.play_date] = (m[r.play_date] || 0) + 1), m), {});
    },
    async archiveGames(uid) { return one(sb.from("games").select("id,play_date,status,state").eq("user_id", uid).eq("mode", "archive").limit(400)); },
    async uploadCard(id, bytes) {
      const { error } = await sb.storage.from("cards").upload(`${id}.png`, bytes, { contentType: "image/png", upsert: true });
      if (error) throw error;
      return sb.storage.from("cards").getPublicUrl(`${id}.png`).data.publicUrl;
    },
    removeCard: async (id) => { await sb.storage.from("cards").remove([`${id}.png`]); },
    savePush: (row) => one(sb.from("push_subscriptions").upsert(row)),
    deletePush: (endpoint) => one(sb.from("push_subscriptions").delete().eq("endpoint", endpoint)),
    getStats: (uid) => one(sb.from("user_stats").select("*").eq("user_id", uid).maybeSingle()),
    putStats: (row) => one(sb.from("user_stats").upsert(row)),

    async dailyTop(date, n, ids) {
      let q = sb.from("daily_results").select("username,total,pct,grid,finished_at,late", { count: "exact" }).eq("play_date", date);
      if (ids) q = q.in("user_id", ids);
      const { data, count, error } = await q.order("total", { ascending: false }).order("pct", { ascending: false }).order("finished_at").limit(n);
      if (error) throw error;
      return { rows: data.map((r) => num(r, "total", "pct")), count };
    },
    async rankedTop(n, ids) {
      let q = sb.from("ranked_stats").select("username,games,rating,best,sr,peak").gte("games", 5);
      if (ids) q = q.in("user_id", ids);
      return (await one(q.order("sr", { ascending: false }).order("games", { ascending: false }).limit(n))).map((r) => num(r, "rating", "best", "sr", "peak"));
    },
    async bestTop(n, ids) {
      let q = sb.from("best_lineups").select("username,total,pct,mode,lineup");
      if (ids) q = q.in("user_id", ids);
      return (await one(q.order("total", { ascending: false }).order("finished_at").limit(n))).map((r) => num(r, "total", "pct"));
    },

    async createGroup({ name, code, owner }) {
      const { data, error } = await sb.from("groups").insert({ name, code, owner }).select("id,code,name").single();
      if (error?.code === "23505") return null; // code collision: caller retries
      if (error) throw error;
      return data;
    },
    findGroupByCode: (code) => one(sb.from("groups").select("id,code,name").eq("code", code).maybeSingle()),
    joinGroup: (groupId, uid) => one(sb.from("group_members").upsert({ group_id: groupId, user_id: uid })),
    leaveGroup: (groupId, uid) => one(sb.from("group_members").delete().eq("group_id", groupId).eq("user_id", uid)),
    async groupMemberIds(groupId) { return (await one(sb.from("group_members").select("user_id").eq("group_id", groupId))).map((r) => r.user_id); },
    // everyone who shares a group with this player, with today's Daily result if they've played
    async friendsToday(uid, date) {
      const mine = (await one(sb.from("group_members").select("group_id").eq("user_id", uid))).map((r) => r.group_id);
      if (!mine.length) return [];
      const ids = [...new Set((await one(sb.from("group_members").select("user_id").in("group_id", mine).limit(2000))).map((r) => r.user_id))].filter((x) => x !== uid);
      if (!ids.length) return [];
      const [profiles, results] = await Promise.all([
        one(sb.from("profiles").select("id,username").in("id", ids)),
        one(sb.from("daily_results").select("user_id,total,grid").eq("play_date", date).in("user_id", ids)),
      ]);
      const res = new Map(results.map((r) => [r.user_id, r]));
      return profiles.map((p) => { const r = res.get(p.id); return { username: p.username, total: r ? Number(r.total) : null, grid: r?.grid || null }; });
    },
    // Daily totals added up per player over a date range (weekly standings)
    async weekTotals(from, to, ids) {
      let q = sb.from("daily_results").select("user_id,username,total").gte("play_date", from).lte("play_date", to);
      if (ids) q = q.in("user_id", ids);
      const rows = await one(q.limit(100000));
      const m = new Map();
      for (const r of rows) { const x = m.get(r.user_id) || { username: r.username, total: 0, days: 0 }; x.total += Number(r.total); x.days++; x.username = r.username; m.set(r.user_id, x); }
      return [...m.values()];
    },
    async myGroups(uid) {
      const rows = await one(sb.from("group_members").select("groups(id,code,name,group_members(count))").eq("user_id", uid));
      return rows.map((r) => ({ id: r.groups.id, code: r.groups.code, name: r.groups.name, members: r.groups.group_members?.[0]?.count ?? 1 }));
    },
  };
}
