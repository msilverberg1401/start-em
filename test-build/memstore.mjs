export function memStore() {
  const T = { profiles: new Map(), games: new Map(), daily: new Map(), ranked: new Map(), best: new Map(), stats: new Map(), groups: new Map(), members: [] };
  const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
  let t = 0;
  return {
    T,
    async getProfile(id) { return clone(T.profiles.get(id)); },
    async findProfileByName(n) { return clone([...T.profiles.values()].find((p) => p.username.toLowerCase() === String(n).toLowerCase()) || null); },
    async createProfile(id, username) {
      if ([...T.profiles.values()].some((p) => p.username.toLowerCase() === username.toLowerCase())) return false;
      T.profiles.set(id, { id, username }); return true;
    },
    async getGame(id) { return clone(T.games.get(id)); },
    async findGame(w) { return clone([...T.games.values()].filter((g) => Object.entries(w).every(([k, v]) => g[k] === v)).sort((a, b) => b.created_at - a.created_at)[0] || null); },
    async insertGame(g) {
      if (g.mode === "daily" && g.user_id && [...T.games.values()].some((x) => x.mode === "daily" && x.user_id === g.user_id && x.play_date === g.play_date)) throw new Error("unique violation daily");
      const row = { ...clone(g), id: crypto.randomUUID(), created_at: ++t }; T.games.set(row.id, row); return clone(row);
    },
    async claimGame(id, uid) { const g = T.games.get(id); if (!g || g.user_id) return false; g.user_id = uid; return true; },
    async updateGame(g) { T.games.set(g.id, { ...T.games.get(g.id), status: g.status, state: clone(g.state) }); return clone(g); },
    async getDaily(d, u) { return clone(T.daily.get(`${d}/${u}`) || null); },
    async putDaily(r) { T.daily.set(`${r.play_date}/${r.user_id}`, { ...clone(r), finished_at: ++t }); },
    async getRanked(u) { return clone(T.ranked.get(u)); },
    async putRanked(r) { T.ranked.set(r.user_id, clone(r)); },
    async getBest(u) { return clone(T.best.get(u)); },
    async putBest(r) { T.best.set(r.user_id, { ...clone(r), finished_at: ++t }); },
    async dailyTop(d, n, ids) { const rows = [...T.daily.values()].filter((r) => r.play_date === d && (!ids || ids.includes(r.user_id))).sort((a, b) => b.total - a.total || b.pct - a.pct || a.finished_at - b.finished_at); return { rows: rows.slice(0, n), count: rows.length }; },
    async rankedTop(n, ids) { return [...T.ranked.values()].filter((r) => r.games >= 5 && (!ids || ids.includes(r.user_id))).sort((a, b) => (b.sr ?? 1000) - (a.sr ?? 1000)).slice(0, n); },
    async bestTop(n, ids) { return [...T.best.values()].filter((r) => !ids || ids.includes(r.user_id)).sort((a, b) => b.total - a.total).slice(0, n); },
    async getBestFull(u) { return clone(T.best.get(u)); },
    async bump(k) { const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); T.counts = T.counts || new Map(); const key = `${d}|${k}`; T.counts.set(key, (T.counts.get(key) || 0) + 1); },
    async statCounts(from) { return [...(T.counts || new Map()).entries()].map(([k, n]) => { const [day, key] = k.split("|"); return { day, key, n }; }).filter((r) => r.day >= from); },
    async statPeople() { return { signups: [...T.profiles.values()].map(() => ({ created_at: new Date().toISOString() })), games: [...T.games.values()].filter((g) => g.user_id).map((g) => ({ user_id: g.user_id, created_at: new Date().toISOString() })), daily: [...T.daily.values()].map((r) => ({ play_date: r.play_date })), rankedPlayers: T.ranked.size, accounts: T.profiles.size }; },
    async getStats(u) { return clone(T.stats.get(u)); },
    async putStats(r) { T.stats.set(r.user_id, clone(r)); },
    async dailyDates(u) { return [...T.daily.values()].filter((r) => r.user_id === u && !r.late).map((r) => r.play_date); },
    async dailyHistory(u, n) { return [...T.daily.values()].filter((r) => r.user_id === u).sort((a, b) => b.play_date.localeCompare(a.play_date)).slice(0, n); },
    async createGroup({ name, code, owner }) { if ([...T.groups.values()].some((g) => g.code === code)) return null; const g = { id: crypto.randomUUID(), code, name, owner }; T.groups.set(g.id, g); return { id: g.id, code, name }; },
    async findGroupByCode(code) { const g = [...T.groups.values()].find((x) => x.code === code); return g ? { id: g.id, code: g.code, name: g.name } : null; },
    async joinGroup(gid, u) { if (!T.members.some((m) => m.g === gid && m.u === u)) T.members.push({ g: gid, u }); },
    async leaveGroup(gid, u) { T.members = T.members.filter((m) => !(m.g === gid && m.u === u)); },
    async groupMemberIds(gid) { return T.members.filter((m) => m.g === gid).map((m) => m.u); },
    async myGroups(u) { return T.members.filter((m) => m.u === u).map((m) => { const g = T.groups.get(m.g); return { id: g.id, code: g.code, name: g.name, members: T.members.filter((x) => x.g === g.id).length }; }); },
    async friendsToday(u, d) {
      const mine = T.members.filter((m) => m.u === u).map((m) => m.g);
      const ids = [...new Set(T.members.filter((m) => mine.includes(m.g)).map((m) => m.u))].filter((x) => x !== u);
      return ids.filter((id) => T.profiles.has(id)).map((id) => { const r = T.daily.get(`${d}/${id}`); return { username: T.profiles.get(id).username, total: r ? r.total : null, grid: r?.grid || null }; });
    },
    async weekTotals(from, to, ids) {
      const m = new Map();
      for (const r of T.daily.values()) {
        if (r.play_date < from || r.play_date > to || (ids && !ids.includes(r.user_id))) continue;
        const x = m.get(r.user_id) || { username: r.username, total: 0, days: 0 }; x.total += r.total; x.days++; m.set(r.user_id, x);
      }
      return [...m.values()];
    },
    async cleanupCasual() {},
    async dailyAll(d) { return [...T.daily.values()].filter((r) => r.play_date === d).map(clone); },
    async dailyCounts(dates) { const m = {}; for (const r of T.daily.values()) if (dates.includes(r.play_date)) m[r.play_date] = (m[r.play_date] || 0) + 1; return m; },
    async uploadCard(id, bytes) { T.cards = T.cards || new Map(); T.cards.set(id, bytes.length); return "https://example.test/cards/" + id + ".png"; },
    async savePush(row) { T.push = T.push || new Map(); T.push.set(row.endpoint, row); },
    async deletePush(endpoint) { T.push?.delete(endpoint); },
    _push: () => T.push, _cards: () => T.cards,
    async archiveGames(u) { return [...T.games.values()].filter((g) => g.user_id === u && g.mode === "archive").map(clone); },
  };
}
