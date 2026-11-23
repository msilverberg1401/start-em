// @ts-nocheck
// Game API. Storage + auth are injected so the same code runs on Supabase and in tests.
import {
  SLOTS, MODES, slotAccepts, rollQueue, todayET, dailyNumber, getRoll, visible, LAUNCH, themeFor, dailyQueue, publicTheme, streaks, weekStart,
  publicRoll, reveal, gradePick, optimalLineup, EMOJI, record, isAllGreen, rerollKey, tierFor, srChange, PLACEMENT_GAMES, START_SR,
} from "./game.ts";

const withTier = (r) => r && { ...r, sr: Number(r.sr ?? START_SR), tier: tierFor(Number(r.sr ?? START_SR)), peakTier: tierFor(Number(r.peak ?? r.sr ?? START_SR)), placing: r.games < PLACEMENT_GAMES, placementTotal: PLACEMENT_GAMES };

// the record formula stays on the server so the 14-0 cutoff can't be read from the site's code
const recStr = (total, row = {}) => { const r = record(Number(total), isAllGreen(row)); return `${r.wins}-${r.losses}`; };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const r1 = (n) => Math.round(n * 10) / 10;
const rulesOf = (g) => g.state.rules || { ...MODES[g.mode], rerolls: undefined };

// who can see the owner stats page (login email). Override with the ADMIN_EMAILS secret, comma separated.
const ADMINS = ((globalThis.Deno?.env?.get?.("ADMIN_EMAILS")) || "msilverberg14.ms@gmail.com").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const isAdmin = (auth) => !!auth?.email && ADMINS.includes(String(auth.email).toLowerCase());

function view(g) {
  const s = g.state;
  const total = r1(s.picks.reduce((a, p) => a + p.player.pts, 0));
  const rules = rulesOf(g);
  return {
    id: g.id, mode: g.mode, date: g.play_date, number: g.play_date ? dailyNumber(g.play_date) : null,
    status: g.status, rerolls: s.rerolls, rules: { hints: !!rules.hints, deep: !!rules.deep, sourceMode: rules.sourceMode || null },
    slots: SLOTS, picks: s.picks, total,
    roll: g.status === "active" ? publicRoll(s.queue[s.cursor], rules, new Set(s.picks.map((p) => p.player.id))) : null,
    rollNumber: s.picks.length + 1, result: s.result || null,
    challenge: s.challengeOf ? { of: s.challengeOf, opponent: s.opponent || null } : null,
    theme: g.play_date && (g.mode === "daily" || g.mode === "archive") ? publicTheme(themeFor(g.play_date)) : null,
  };
}

function newState(mode, seed, extra = {}, queue = null) {
  const m = MODES[mode];
  return { seed, queue: queue || rollQueue(seed), cursor: 0, rerolls: { ...m.rerolls }, rules: { hints: m.hints, deep: m.deep }, picks: [], used: [], ...extra };
}

// what a finished game looks like to someone else (challenges, H2H)
async function summary(db, g) {
  const r = g.state.result;
  const prof = g.user_id ? await db.getProfile(g.user_id) : null;
  return {
    id: g.id, username: prof?.username || "A friend", mode: g.mode, sourceMode: g.state.rules?.sourceMode || g.mode,
    date: g.play_date, number: g.play_date ? dailyNumber(g.play_date) : null,
    total: r.total, pct: r.pct, record: r.record, grid: r.grid,
    picks: g.state.picks.map((p) => ({ slot: p.slot, name: p.player.name, pts: p.player.pts, season: p.season, team: p.team, grade: p.grade })),
  };
}

async function finish(db, g, profile) {
  const s = g.state;
  const opt = optimalLineup(s.used);
  const total = r1(s.picks.reduce((a, p) => a + p.player.pts, 0));
  const pct = r1((total / opt.total) * 100);
  const bestPick = [...s.picks].sort((a, b) => b.player.pts - a.player.pts)[0];
  const worst = s.picks.map((p) => ({ p, d: p.player.pts - p.best.pts })).sort((a, b) => a.d - b.d)[0];
  s.result = {
    total, optimal: opt.total, pct, record: record(total, s.picks.every((p) => p.grade === "best")), optimalLineup: opt.lineup,
    grid: s.picks.map((p) => EMOJI[p.grade]).join(""),
    bestPick: { name: bestPick.player.name, pts: bestPick.player.pts, season: bestPick.season, team: bestPick.team },
    biggestMiss: worst.d < 0 ? { name: worst.p.player.name, pts: worst.p.player.pts, instead: worst.p.best.name, insteadPts: worst.p.best.pts, lost: r1(-worst.d), season: worst.p.season, team: worst.p.team } : null,
  };
  g.status = "done";
  if (s.challengeOf) {
    const src = await db.getGame(s.challengeOf);
    if (src?.status === "done") s.opponent = await summary(db, src);
  }
  if (!g.user_id || !profile) return;

  // lifetime stats for the profile page (every mode). Reads run side by side, then writes run side by side.
  const isRanked = MODES[g.mode].ranked, uid = g.user_id;
  const [st0, prevRanked, best] = await Promise.all([
    db.getStats(uid),
    isRanked && g.mode !== "daily" ? db.getRanked(uid) : null,
    isRanked ? db.getBest(uid) : null,
  ]);
  const st = st0 || { games: 0, greens: 0, best_pick: null, worst_miss: null, best_wins: 0 };
  st.games += 1;
  st.greens += s.picks.filter((p) => p.grade === "best").length;
  st.best_wins = Math.max(st.best_wins, s.result.record.wins);
  if (!st.best_pick || bestPick.player.pts > st.best_pick.pts) st.best_pick = { ...s.result.bestPick, mode: g.mode };
  if (s.result.biggestMiss && (!st.worst_miss || s.result.biggestMiss.lost > st.worst_miss.lost)) st.worst_miss = { ...s.result.biggestMiss, mode: g.mode };
  const writes = [db.putStats({ user_id: uid, ...st })];

  if (isRanked) {
    const username = profile.username;
    if (g.mode === "daily") {
      writes.push(db.putDaily({ play_date: g.play_date, user_id: uid, username, total, pct, grid: s.result.grid,
        picks: s.picks.map((p, i) => ({ i, rollKey: p.rollKey, id: p.player.id, name: p.player.name, pts: p.player.pts, slot: p.slot })) }));
    } else {
      const prev = prevRanked || { games: 0, recent: [], best: 0, sr: START_SR, peak: START_SR, history: [] };
      const recent = [...prev.recent.map(Number), pct].slice(-20);
      const before = Number(prev.sr ?? START_SR), delta = srChange(before, pct, prev.games, s.result.record.wins), after = Math.max(0, before + delta);
      const games = prev.games + 1, placing = games <= PLACEMENT_GAMES;
      const tb = tierFor(before), ta = tierFor(after);
      s.result.ranked = { before, after, delta, games, placement: placing ? games : null, placementTotal: PLACEMENT_GAMES,
        tierBefore: tb, tier: ta, moved: prev.games >= PLACEMENT_GAMES && ta.rank !== tb.rank ? (ta.rank > tb.rank ? "up" : "down") : null,
        placed: games === PLACEMENT_GAMES };
      writes.push(db.putRanked({
        user_id: uid, username, games, recent,
        rating: r1(recent.reduce((a, b) => a + b, 0) / recent.length), best: Math.max(Number(prev.best), total),
        sr: after, peak: Math.max(Number(prev.peak ?? START_SR), after), history: [...(prev.history || []), delta].slice(-10),
      }));
    }
    if (!best || total > Number(best.total)) {
      writes.push(db.putBest({
        user_id: uid, username, total, pct, mode: g.mode,
        lineup: s.picks.map((p) => ({ slot: p.slot, name: p.player.name, season: p.season, team: p.team, pts: p.player.pts, grade: p.grade })),
      }));
    }
  }
  // every save must land before the game itself is marked done (the caller saves the game after this returns)
  await Promise.all(writes);
}

// consecutive Daily days. The current streak survives until midnight if today isn't played yet.

async function needUser(auth, db) {
  if (!auth) fail(401, "Log in to play Daily and Ranked.");
  const profile = await db.getProfile(auth.id);
  if (!profile) fail(428, "Pick a username to finish setting up your account.");
  return profile;
}

async function memberIds(db, auth, groupId) {
  if (!groupId) return null;
  const ids = await db.groupMemberIds(groupId);
  if (!auth || !ids.includes(auth.id)) fail(403, "Join this group to see its standings.");
  return ids;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const makeCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

const actions = {
  async me({ auth, db }) {
    const today = todayET();
    const theme = publicTheme(themeFor(today));
    if (!auth) return { signedIn: false, today, dailyNumber: dailyNumber(today), theme };
    const profile = await db.getProfile(auth.id);
    if (!profile) return { signedIn: true, email: auth.email, username: null, today, dailyNumber: dailyNumber(today), theme };
    // independent lookups, so run them together instead of one after another
    const [dailyDone, dailyGame, ranked, rankedGame, dates, groups, friends] = await Promise.all([
      db.getDaily(today, auth.id),
      db.findGame({ user_id: auth.id, mode: "daily", play_date: today, status: "active" }),
      db.getRanked(auth.id),
      db.findGame({ user_id: auth.id, mode: "ranked", status: "active" }),
      db.dailyDates(auth.id),
      db.myGroups(auth.id),
      db.friendsToday(auth.id, today),
    ]);
    // played first (highest score first), then who hasn't played yet
    const fr = friends.map((f) => ({ ...f, record: f.total == null ? null : recStr(f.total, f) }))
      .sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.username.localeCompare(b.username));
    return {
      signedIn: true, email: auth.email, username: profile.username, today, dailyNumber: dailyNumber(today), theme, admin: isAdmin(auth) || undefined,
      dailyDone: dailyDone && { ...dailyDone, total: Number(dailyDone.total), record: recStr(Number(dailyDone.total), dailyDone) },
      dailyActive: !!dailyGame, ranked: withTier(ranked), rankedActive: !!rankedGame,
      streak: streaks(dates, today), groups,
      friends: { played: fr.filter((f) => f.total != null).length, total: fr.length, list: fr.slice(0, 12) },
    };
  },

  async adminStats({ auth, db }) {
    if (!isAdmin(auth)) fail(403, "Not available.");
    const today = todayET(), days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - i); days.push(d.toISOString().slice(0, 10)); }
    const [counts, people] = await Promise.all([db.statCounts(days[0]), db.statPeople(`${days[0]}T00:00:00-05:00`)]);
    const etDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
    const row = Object.fromEntries(days.map((d) => [d, { day: d, c: {}, signups: 0, players: new Set(), daily: 0 }]));
    for (const r of counts) if (row[r.day]) row[r.day].c[r.key] = Number(r.n);
    for (const p of people.signups) { const d = etDay(p.created_at); if (row[d]) row[d].signups++; }
    for (const g of people.games) { const d = etDay(g.created_at); if (row[d]) row[d].players.add(g.user_id); }
    for (const x of people.daily) if (row[x.play_date]) row[x.play_date].daily++;
    return {
      today, accounts: people.accounts, rankedPlayers: people.rankedPlayers,
      days: days.map((d) => ({ ...row[d], players: row[d].players.size })).reverse(),
    };
  },

  async setUsername({ auth, db, body }) {
    if (!auth) fail(401, "Log in first.");
    const name = String(body.username || "").trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) fail(400, "Usernames are 3–16 letters, numbers or underscores.");
    if (await db.getProfile(auth.id)) fail(409, "Your username is already set.");
    if (!(await db.createProfile(auth.id, name))) fail(409, "That username is taken. Try another.");
    return { username: name };
  },

  async start({ auth, db, body }) {
    const mode = body.mode;
    if (mode === "challenge") return startChallenge({ auth, db, body });
    if (mode === "archive") return startArchive({ auth, db, body });
    if (!MODES[mode] || mode === "challenge" || mode === "archive") fail(400, "Pick a mode: daily, ranked or casual.");
    if (mode === "casual") {
      if (Math.random() < 0.02) db.cleanupCasual?.().catch(() => {});
      return view(await db.insertGame({ user_id: auth?.id || null, mode, play_date: null, status: "active", state: newState(mode, `casual-${crypto.randomUUID()}`) }));
    }
    await needUser(auth, db);
    if (mode === "daily") {
      const today = todayET();
      const existing = await db.findGame({ user_id: auth.id, mode: "daily", play_date: today });
      if (existing?.status === "done") fail(409, "You've played today's Daily. A new one unlocks at midnight ET.");
      if (existing) return view(existing);
      return view(await db.insertGame({ user_id: auth.id, mode, play_date: today, status: "active", state: newState(mode, `daily-${today}`, {}, dailyQueue(today)) }));
    }
    // ranked: no restarting a bad game — resume the active one
    const active = await db.findGame({ user_id: auth.id, mode: "ranked", status: "active" });
    if (active) return view(active);
    return view(await db.insertGame({ user_id: auth.id, mode, play_date: null, status: "active", state: newState(mode, `ranked-${crypto.randomUUID()}`) }));
  },

  dailyStats: dailyStatsFor,

  // Your own finished Daily for a day (profile calendar, or "Daily done" on home), so it can be looked at and shared later.
  async dayCard({ auth, db, body }) {
    await needUser(auth, db);
    const date = body.date || todayET();
    if (!validDate(date)) fail(400, "Bad date.");
    const g = await finishedDayGame(db, auth.id, date);
    if (!g) fail(404, "You didn't finish that Daily.");
    return summary(db, g);
  },

  // Someone else's Daily lineup from the standings. Only once you've finished that same Daily yourself,
  // so nobody can open the board and read today's answers.
  async scorecard({ auth, db, body }) {
    await needUser(auth, db);
    const date = body.date || todayET();
    if (!validDate(date)) fail(400, "Bad date.");
    if (!(await finishedDayGame(db, auth.id, date))) fail(403, `Finish Daily #${dailyNumber(date)} to see other lineups.`);
    const who = await db.findProfileByName(String(body.username || "").trim());
    const g = who && (await db.findGame({ user_id: who.id, mode: "daily", play_date: date, status: "done" }));
    if (!g) fail(404, "Couldn't find that lineup.");
    return summary(db, g);
  },

  async archiveList({ auth, db }) {
    const today = todayET(), dates = [];
    for (let d = dayAdd(today, -1); d >= LAUNCH && dates.length < 60; d = dayAdd(d, -1)) dates.push(d);
    const counts = await db.dailyCounts(dates);
    const mine = {};
    if (auth) {
      for (const g of await db.archiveGames(auth.id)) mine[g.play_date] = g.status === "done" ? { total: g.state.result.total, record: g.state.result.record, played: "archive" } : { active: true };
      for (const d of dates) { const r = await db.getDaily(d, auth.id); if (r) mine[d] = { total: Number(r.total), record: record(Number(r.total), isAllGreen(r)), played: "daily" }; }
    }
    return { days: dates.map((d) => ({ date: d, number: dailyNumber(d), players: counts[d] || 0, mine: mine[d] || null, theme: publicTheme(themeFor(d)) })) };
  },

  // save the finished game's share card so link previews can show it (only the game's owner, only finished games)
  async uploadCard({ auth, db, body }) {
    const g = body.game && (await db.getGame(String(body.game)));
    if (!g || g.status !== "done") fail(404, "That game isn't finished.");
    if (g.user_id && g.user_id !== auth?.id) fail(403, "That game belongs to another account.");
    if (spoils(g)) fail(400, "Daily cards aren't used for link previews, so the lineup stays a surprise.");
    const b64 = String(body.png || "").replace(/^data:image\/png;base64,/, "");
    if (!b64 || b64.length > 2_700_000) fail(400, "Card image is missing or too big.");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) fail(400, "That isn't a PNG.");
    return { url: await db.uploadCard(g.id, bytes) };
  },

  // daily reminder sign-up (web push). Works logged in or out.
  async savePush({ auth, db, body }) {
    const sub = body.sub;
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) fail(400, "That reminder sign-up didn't work. Try again.");
    await db.savePush({ endpoint: sub.endpoint, user_id: auth?.id || null, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } });
    return { ok: true };
  },
  async deletePush({ db, body }) {
    if (typeof body.endpoint === "string") await db.deletePush(body.endpoint);
    return { ok: true };
  },

  async challengeInfo({ db, body }) {
    const g = body.id && (await db.getGame(String(body.id)));
    if (!g || g.status !== "done") fail(404, "That challenge link doesn't work. Ask your friend to send it again.");
    // Daily cards show the lineup, so they must never be a link preview. Clear any saved before this rule existed.
    if (spoils(g) && db.removeCard) { const p = db.removeCard(g.id).catch(() => {}); try { globalThis.EdgeRuntime?.waitUntil?.(p); } catch {} }
    return noPicks(await summary(db, g));
  },

  async reroll({ auth, db, body }) {
    const g = await loadOwned(db, auth, body.game);
    const s = g.state, kind = body.kind;
    if (kind !== "team" && kind !== "year") fail(400, "Reroll the team or the year.");
    if (!s.rerolls[kind]) fail(400, g.mode === "daily" ? "The Daily has no rerolls. Everyone plays the same seven teams." : `No ${kind} rerolls left this game.`);
    const exclude = new Set([...s.used, ...s.queue.slice(s.cursor + 1)]);
    const next = rerollKey(s.queue[s.cursor], kind, `${s.seed}|${s.picks.length}|${kind}|${s.rerolls.team}${s.rerolls.year}`, exclude);
    if (!next) fail(400, kind === "year" ? "This franchise has no other seasons to roll." : "No other teams to roll for this season.");
    s.queue[s.cursor] = next; s.rerolls[kind] -= 1;
    await db.updateGame(g);
    return view(g);
  },

  async pick({ auth, db, body }) {
    const g = await loadOwned(db, auth, body.game);
    const s = g.state;
    const rollKey = s.queue[s.cursor];
    const roll = getRoll(rollKey);
    const p = roll.players.find((x) => x.id === body.player && visible(x, rulesOf(g)));
    if (!p) fail(400, "That player isn't on this roll.");
    const slot = body.slot;
    if (!SLOTS.includes(slot) || s.picks.some((x) => x.slot === slot)) fail(400, "That lineup spot is already filled.");
    if (!slotAccepts(slot, p.pos)) fail(400, `A ${p.pos} can't go in the ${slot.replace(/\d/, "")} spot.`);
    const taken = new Set(s.picks.map((x) => x.player.id));
    if (taken.has(p.id)) fail(400, `${p.name} is already in your lineup. You can't start him twice.`);
    const { grade, best } = gradePick(rollKey, slot, p, taken);
    const pick = { slot, rollKey, season: roll.season, team: roll.team, teamName: roll.teamName, player: reveal(p), grade, best };
    s.picks.push(pick); s.used.push(rollKey); s.cursor += 1;
    if (s.picks.length === SLOTS.length) await finish(db, g, g.user_id ? await db.getProfile(g.user_id) : null);
    await db.updateGame(g);
    return { ...view(g), lastPick: pick };
  },

  async leaderboard({ auth, db, body }) {
    const board = body.board || "daily";
    const ids = await memberIds(db, auth, body.group);
    if (board === "daily") {
      const date = body.date || todayET();
      const { rows, count } = await db.dailyTop(date, 10, ids);
      return { board, date, number: dailyNumber(date), players: count, rows: rows.map((x) => ({ ...x, record: recStr(x.total, x) })) };
    }
    if (board === "week") {
      const today = todayET(), from = weekStart(today);
      const all = (await db.weekTotals(from, today, ids)).map((x) => ({ ...x, total: r1(x.total) }))
        .sort((a, b) => b.total - a.total || b.days - a.days);
      return { board, from, to: today, players: all.length, rows: all.slice(0, 10) };
    }
    if (board === "ranked") return { board, rows: (await db.rankedTop(10, ids)).map((x) => ({ ...x, tier: tierFor(Number(x.sr ?? START_SR)) })) };
    if (board === "alltime") return { board, rows: (await db.bestTop(10, ids)).map((x) => ({ ...x, record: recStr(x.total, x) })) };
    fail(400, "Unknown leaderboard.");
  },

  async createGroup({ auth, db, body }) {
    await needUser(auth, db);
    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 32) fail(400, "Group names are 3–32 characters.");
    if ((await db.myGroups(auth.id)).length >= 10) fail(400, "You can be in up to 10 groups.");
    let group = null;
    for (let i = 0; i < 5 && !group; i++) group = await db.createGroup({ name, code: makeCode(), owner: auth.id });
    if (!group) fail(500, "Couldn't make a group code. Try again.");
    await db.joinGroup(group.id, auth.id);
    return { ...group, members: 1 };
  },

  async joinGroup({ auth, db, body }) {
    await needUser(auth, db);
    const group = await db.findGroupByCode(String(body.code || "").trim().toUpperCase());
    if (!group) fail(404, "No group has that code. Check it and try again.");
    const mine = await db.myGroups(auth.id);
    if (mine.some((x) => x.id === group.id)) return { ...group, already: true };
    if (mine.length >= 10) fail(400, "You can be in up to 10 groups.");
    await db.joinGroup(group.id, auth.id);
    return group;
  },

  async leaveGroup({ auth, db, body }) {
    await needUser(auth, db);
    await db.leaveGroup(String(body.group), auth.id);
    return { ok: true };
  },

  async profile({ auth, db }) {
    const profile = await needUser(auth, db);
    const today = todayET();
    const dates = await db.dailyDates(auth.id);
    return {
      username: profile.username, joined: profile.created_at || null,
      streak: streaks(dates, today),
      daily: (await db.dailyHistory(auth.id, 21)).map((x) => ({ ...x, record: recStr(x.total, x) })),
      ranked: withTier(await db.getRanked(auth.id)),
      best: await (async () => { const b = await db.getBestFull(auth.id); return b && { ...b, record: recStr(b.total, b) }; })(),
      stats: await db.getStats(auth.id),
      groups: await db.myGroups(auth.id),
    };
  },
};

const dayAdd = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const validDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

// a challenge link is opened by people who haven't played those teams yet: send the score, never the picks
const noPicks = ({ picks, ...rest }) => rest;
// a Daily's lineup (today's, or a past one people can still play) would spoil it if it showed in a link preview
const spoils = (g) => g.mode === "daily" || g.mode === "archive" || g.state?.rules?.sourceMode === "daily" || g.state?.rules?.sourceMode === "archive";

// a Daily this account finished, either on the day or later as a past Daily
async function finishedDayGame(db, uid, date) {
  const daily = await db.findGame({ user_id: uid, mode: "daily", play_date: date, status: "done" });
  return daily || (await db.findGame({ user_id: uid, mode: "archive", play_date: date, status: "done" }));
}

async function startArchive({ auth, db, body }) {
  const date = body.date, today = todayET();
  if (!validDate(date) || date < LAUNCH || date >= today) fail(400, "That isn't a past Daily you can play.");
  if (auth) {
    const prev = await db.findGame({ user_id: auth.id, mode: "archive", play_date: date });
    if (prev) return view(prev); // resume, or show the finished result
    const daily = await db.getDaily(date, auth.id);
    if (daily) fail(409, "You already played this one as the Daily that day.");
  }
  const st = newState("archive", `daily-${date}`, {}, dailyQueue(date));
  return view(await db.insertGame({ user_id: auth?.id || null, mode: "archive", play_date: date, status: "active", state: st }));
}

// How everyone played a Daily. Locked until you've finished that Daily (today's, or a past one in the archive).
async function dailyStatsFor({ auth, db, body }) {
  const date = body.date || todayET();
  if (!validDate(date)) fail(400, "Bad date.");
  let mine = null;
  if (auth) {
    const d = await db.getDaily(date, auth.id);
    if (d) mine = { total: Number(d.total), picks: d.picks || null, source: "daily" };
  }
  if (!mine && body.game) {
    const g = await db.getGame(String(body.game));
    if (g && g.status === "done" && (g.mode === "archive" || g.mode === "daily") && g.play_date === date && (!g.user_id || g.user_id === auth?.id)) {
      mine = { total: g.state.result.total, grid: g.state.result.grid, picks: g.state.picks.map((p, i) => ({ i, id: p.player.id, rollKey: p.rollKey })), source: g.mode };
    }
  }
  if (!mine) fail(403, "Finish this Daily to see how everyone played it.");
  const rows = await db.dailyAll(date);
  const others = rows.filter((r) => !(auth && r.user_id === auth.id));
  const n = others.length;
  const beat = n ? Math.round((others.filter((r) => r.total < mine.total).length / n) * 100) : null;
  const wins = Array(15).fill(0);
  for (const r of rows) wins[record(r.total, isAllGreen(r)).wins]++;
  if (mine.source === "archive") wins[record(mine.total, isAllGreen(mine)).wins]++;
  const queue = dailyQueue(date);
  const rolls = queue.slice(0, 7).map((key, i) => {
    const counts = new Map();
    for (const r of rows) {
      const p = (r.picks || []).find((x) => x.i === i);
      if (p) counts.set(p.id, { name: p.name, n: (counts.get(p.id)?.n || 0) + 1 });
    }
    const total = [...counts.values()].reduce((s, x) => s + x.n, 0);
    const top = [...counts.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 3)
      .map(([id, x]) => ({ id, name: x.name, pct: total ? Math.round((x.n / total) * 100) : 0 }));
    const myPick = (mine.picks || []).find((x) => x.i === i);
    const roll = getRoll(key);
    const myName = myPick ? roll.players.find((p) => p.id === myPick.id)?.name : null;
    const myPct = myPick && total ? Math.round(((counts.get(myPick.id)?.n || 0) / total) * 100) : null;
    return { i, season: roll.season, team: roll.team, teamName: roll.teamName, top, mine: myName, minePct: myPct };
  });
  const rarest = rolls.filter((x) => x.mine && x.minePct != null).sort((x, y) => x.minePct - y.minePct)[0] || null;
  return { date, number: dailyNumber(date), theme: publicTheme(themeFor(date)), players: rows.length + (mine.source === "archive" ? 1 : 0), beat, wins, rolls,
    rarest: rarest ? { name: rarest.mine, pct: rarest.minePct, season: rarest.season, team: rarest.team } : null, archive: mine.source === "archive" };
}

async function startChallenge({ auth, db, body }) {
  const src = body.challenge && (await db.getGame(String(body.challenge)));
  if (!src || src.status !== "done") fail(404, "That challenge link doesn't work. Ask your friend to send it again.");
  const opponent = noPicks(await summary(db, src)); // picks would give away the answers before they play
  // a Daily challenge from today is just today's Daily, so nobody gets a free look at it
  if (src.mode === "daily" && src.play_date === todayET()) return { redirectDaily: true, opponent };
  if (auth && src.user_id === auth.id) fail(400, "That's your own game. Send the link to a friend.");
  if (auth) {
    const prev = await db.findGame({ user_id: auth.id, mode: "challenge", challenge_of: src.id });
    if (prev) return view(prev);
  }
  const srcRules = src.state.rules || MODES[src.mode];
  const sourceMode = src.state.rules?.sourceMode || src.mode;
  const st = newState("challenge", src.state.seed, { challengeOf: src.id, opponent: null }, src.play_date && (src.mode === "daily" || src.mode === "archive") ? dailyQueue(src.play_date) : null);
  st.rules = { hints: !!srcRules.hints, deep: !!srcRules.deep, sourceMode };
  st.rerolls = { ...MODES[sourceMode === "challenge" ? "daily" : sourceMode].rerolls };
  return view(await db.insertGame({ user_id: auth?.id || null, mode: "challenge", play_date: null, status: "active", challenge_of: src.id, state: st }));
}

async function loadOwned(db, auth, id) {
  const g = id && (await db.getGame(String(id)));
  if (!g || g.status !== "active") fail(404, "That game isn't active.");
  if (g.user_id && g.user_id !== auth?.id) fail(403, "That game belongs to another account.");
  return g;
}

// owner stats counters. Fire and forget: a counter must never slow down or break a request.
function track(db, action, out) {
  if (!db.bump) return;
  const keys = action === "me" ? ["visit"]
    : action === "start" && out?.mode ? [`open:${out.mode}`]
    : action === "pick" && out?.picks ? [`pick:${out.picks.length}`, ...(out.status === "done" ? [`finish:${out.mode}`] : [])]
    : [];
  for (const k of keys) {
    const p = db.bump(k).catch(() => {});
    try { globalThis.EdgeRuntime?.waitUntil?.(p); } catch { /* not on the edge runtime */ }
  }
}

export async function handle({ body, auth, db }) {
  const fn = actions[body?.action];
  if (!fn) return { status: 404, body: { error: "Unknown action." } };
  try {
    const out = await fn({ auth, db, body });
    if (!isAdmin(auth) && !body.nt) track(db, body.action, out); // the owner's own visits and games don't count
    return { status: 200, body: out };
  }
  catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: "Something broke on our end. Try again." } };
  }
}
