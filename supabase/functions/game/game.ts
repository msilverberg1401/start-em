// @ts-nocheck
import rolls from "./rolls.json" with { type: "json" };

export const ROLLS = rolls;
const BY_KEY = new Map(rolls.map((r) => [r.key, r]));
export const getRoll = (k) => BY_KEY.get(k);

export const SLOTS = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX"];
export const slotAccepts = (slot, pos) =>
  slot === "FLEX" ? ["RB", "WR", "TE"].includes(pos) : slot.replace(/\d/, "") === pos;

// rules per mode. deep = full rosters (more trap players). hints = Casual's stats-on view.
export const MODES = {
  daily: { rerolls: { team: 0, year: 0 }, hints: false, deep: false, ranked: true },
  ranked: { rerolls: { team: 1, year: 1 }, hints: false, deep: true, ranked: true },
  casual: { rerolls: { team: 1, year: 1 }, hints: true, deep: false, ranked: false },
  challenge: { rerolls: { team: 1, year: 1 }, hints: false, deep: false, ranked: false }, // real rules copied from the source game
  archive: { rerolls: { team: 0, year: 0 }, hints: false, deep: false, ranked: false }, // a past Daily, unranked
};
const SHALLOW = { QB: 3, RB: 5, WR: 6, TE: 3 };
export const visible = (p, rules) => rules.deep || p.d < SHALLOW[p.pos];

// franchises that moved keep one identity for "new year" rerolls
const FRANCHISE = { STL: "LAR", SD: "LAC", OAK: "LV" };
const franchise = (team) => FRANCHISE[team] || team;

// ---------- seeded randomness ----------
function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rollQueue(seed, n = 7 + 4, pool = rolls) {
  const rnd = mulberry32(hash(seed));
  const picked = new Set();
  const out = [];
  const want = Math.min(n, pool.length);
  while (out.length < want) {
    const r = pool[Math.floor(rnd() * pool.length)];
    if (!picked.has(r.key)) { picked.add(r.key); out.push(r.key); }
  }
  return out;
}

// ---------- themed Dailies ----------
const DIVISIONS = [
  ["AFC East", ["BUF", "MIA", "NE", "NYJ"]], ["NFC North", ["CHI", "DET", "GB", "MIN"]],
  ["AFC West", ["DEN", "KC", "LV", "LAC"]], ["NFC South", ["ATL", "CAR", "NO", "TB"]],
  ["AFC North", ["BAL", "CIN", "CLE", "PIT"]], ["NFC West", ["ARI", "LAR", "SF", "SEA"]],
  ["AFC South", ["HOU", "IND", "JAX", "TEN"]], ["NFC East", ["DAL", "NYG", "PHI", "WAS"]],
];
// Super Bowl winners by season (1999-2024)
const CHAMPS = { 1999: "LAR", 2000: "BAL", 2001: "NE", 2002: "TB", 2003: "NE", 2004: "NE", 2005: "PIT", 2006: "IND", 2007: "NYG", 2008: "PIT", 2009: "NO", 2010: "GB", 2011: "NYG", 2012: "BAL", 2013: "SEA", 2014: "NE", 2015: "DEN", 2016: "NE", 2017: "PHI", 2018: "NE", 2019: "KC", 2020: "TB", 2021: "LAR", 2022: "KC", 2023: "KC", 2024: "PHI" };
const nthWeekday = (y, m, wd, n) => { const d = new Date(Date.UTC(y, m, 1)); const off = (wd - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + (n - 1) * 7)).toISOString().slice(0, 10); };
export function themeFor(date) {
  const d = new Date(date + "T12:00:00Z"), y = d.getUTCFullYear(), wd = d.getUTCDay();
  if (date === nthWeekday(y, 10, 4, 4)) return { key: "thanksgiving", name: "Thanksgiving Daily", desc: "Every roll is a Lions or Cowboys season.", teams: ["DET", "DAL"] };
  if (date === nthWeekday(y, 1, 0, 2)) return { key: "champions", name: "Champions Daily", desc: "Every roll is a Super Bowl champion.", champs: true };
  if (wd === 4) return { key: "throwback", name: "Throwback Thursday", desc: "Only seasons from 1999 to 2009.", years: [1999, 2009] };
  if (wd === 0) {
    const week = Math.floor(Date.parse(date) / (7 * 864e5));
    const [name, teams] = DIVISIONS[week % DIVISIONS.length];
    return { key: "division", name: `Division Sunday: ${name}`, desc: `Every roll comes from the ${name}.`, teams };
  }
  return null;
}
const franchiseOf = (t) => FRANCHISE_MAP[t] || t;
const FRANCHISE_MAP = { STL: "LAR", SD: "LAC", OAK: "LV" };
export function themePool(theme) {
  if (!theme) return rolls;
  return rolls.filter((r) =>
    (!theme.teams || theme.teams.includes(franchiseOf(r.team))) &&
    (!theme.years || (r.season >= theme.years[0] && r.season <= theme.years[1])) &&
    (!theme.champs || CHAMPS[r.season] === franchiseOf(r.team)));
}
// DAILY_SALT is a secret set in Supabase (Edge Functions → Secrets). Without it, anyone reading this public
// repo could compute future Dailies. Set it once before launch and never change it, or past Dailies reshuffle.
const DAILY_SALT = globalThis.Deno?.env.get("DAILY_SALT") ?? globalThis.__SE_SALT ?? "";
if (globalThis.Deno && !DAILY_SALT) console.error("DAILY_SALT is not set: Dailies are predictable from the public code.");
// Daily #1 (launch day) was played before the salt existed, so it keeps its original rolls.
const SALT_FROM = "2026-11-23";
export const dailyQueue = (date) =>
  rollQueue(date < SALT_FROM ? `daily-${date}|` : `daily-${date}|${DAILY_SALT}`, 11, themePool(themeFor(date)));
export const publicTheme = (t) => t && { key: t.key, name: t.name, desc: t.desc };

// Reroll the current roll. kind "team": same season, another team. kind "year": same franchise, another season.
// Seeded, so everyone who rerolls the same Daily roll gets the same replacement.
export function rerollKey(currentKey, kind, seed, exclude) {
  const cur = BY_KEY.get(currentKey);
  const pool = rolls.filter((r) => !exclude.has(r.key) && r.key !== currentKey &&
    (kind === "team" ? r.season === cur.season && r.team !== cur.team
                     : franchise(r.team) === franchise(cur.team) && r.season !== cur.season));
  if (!pool.length) return null;
  const rnd = mulberry32(hash(seed));
  return pool[Math.floor(rnd() * pool.length)].key;
}

export function todayET(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}
export const LAUNCH = globalThis.__SE_LAUNCH || "2026-11-22";
export function dailyNumber(date) {
  return Math.round((Date.parse(date) - Date.parse(LAUNCH)) / 864e5) + 1;
}

// ---------- what the player is allowed to see ----------
export function publicRoll(key, rules, taken = new Set()) {
  const r = getRoll(key);
  const hints = rules.hints;
  return {
    key: r.key, season: r.season, team: r.team, teamName: r.teamName,
    // alphabetical by last name inside each position: the stored order is by points and would leak answers
    players: r.players.filter((p) => visible(p, rules)).sort((a, b) =>
      a.pos.localeCompare(b.pos) || a.name.split(" ").slice(1).join(" ").localeCompare(b.name.split(" ").slice(1).join(" ")) || a.name.localeCompare(b.name)
    ).map((p) => {
      const o = { id: p.id, name: p.name, pos: p.pos };
      if (taken.has(p.id)) o.taken = true;
      if (hints) { o.g = p.g; o.yr = p.yr; o.u = p.u; }
      return o;
    }),
  };
}
export const reveal = (p) => ({ id: p.id, name: p.name, pos: p.pos, pts: p.pts, ppg: p.ppg, g: p.g, rank: p.rank });

// ---------- scoring ----------
const bestFor = (roll, slot, exclude = new Set()) => {
  let best = null;
  for (const p of roll.players) if (slotAccepts(slot, p.pos) && !exclude.has(p.id) && (!best || p.pts > best.pts)) best = p;
  return best;
};

// grade against the best player you were actually allowed to start (players already in your lineup don't count)
export function gradePick(rollKey, slot, player, exclude = new Set()) {
  const best = bestFor(getRoll(rollKey), slot, exclude);
  const ratio = best && best.pts > 0 ? player.pts / best.pts : 1;
  return { grade: ratio >= 0.999 ? "best" : ratio >= 0.75 ? "close" : "miss", best: reveal(best) };
}

// best possible lineup using the exact rolls the player accepted (hindsight).
// One player per roll, one roll per slot, and no player twice (he can appear on two rolls, e.g. two Lions seasons).
export function optimalLineup(rollKeys) {
  const rs = rollKeys.map(getRoll);
  // top 3 candidates per roll per slot is enough to route around any duplicate
  const cand = rs.map((r) => SLOTS.map((s) => r.players.filter((p) => slotAccepts(s, p.pos)).sort((x, y) => y.pts - x.pts).slice(0, 3)));
  const top = cand.map((row) => Math.max(...row.map((c) => (c[0] ? c[0].pts : 0))));
  const rest = top.map((_, i) => top.slice(i).reduce((a, b) => a + b, 0));
  let best = { total: -1, assign: null };
  const usedSlot = new Array(SLOTS.length).fill(false), usedPlayer = new Set(), assign = [];
  (function rec(i, total) {
    if (i === rs.length) { if (total > best.total) best = { total, assign: [...assign] }; return; }
    if (total + rest[i] <= best.total) return; // can't beat what we have
    for (let s = 0; s < SLOTS.length; s++) {
      if (usedSlot[s]) continue;
      for (const p of cand[i][s]) {
        if (usedPlayer.has(p.id)) continue;
        usedSlot[s] = true; usedPlayer.add(p.id); assign.push([s, p]);
        rec(i + 1, total + p.pts);
        usedSlot[s] = false; usedPlayer.delete(p.id); assign.pop();
      }
    }
  })(0, 0);
  return {
    total: Math.round(best.total * 10) / 10,
    lineup: best.assign.map(([s, p], i) => ({ slot: SLOTS[s], rollKey: rs[i].key, teamName: rs[i].teamName, season: rs[i].season, player: reveal(p) })),
  };
}

export const EMOJI = { best: "🟩", close: "🟨", miss: "🟥" };

// Season record from raw PPR, like 82-0: the team's real strength. 14-0 takes 2,100+ (perfect picks on great rolls).
// Calibrated by simulation: random picks ~700, a stat-follower ~1,450, an expert ~1,700, perfect picks ~1,800.
export const RECORD = { floor: 900, perfect: 2100 };
export function winsFor(total, allGreen = false) {
  // 14-0 takes the points AND a perfect card: every pick the best on its roll. Big points with a miss top out at 13-1.
  if (total >= RECORD.perfect) return allGreen ? 14 : 13;
  return Math.max(0, Math.min(13, Math.floor((14 * (total - RECORD.floor)) / (RECORD.perfect - RECORD.floor))));
}
export function record(total, allGreen = false) { const w = winsFor(total, allGreen); return { wins: w, losses: 14 - w }; }
// all seven picks green, from the stored emoji grid, the lineup's grades, or (older rows) 100% accuracy
export function isAllGreen({ grid, lineup, pct } = {}) {
  if (grid) { const sq = [...grid]; return sq.length === 7 && sq.every((c) => c === EMOJI.best); }
  if (lineup?.length && lineup.every((l) => l.grade)) return lineup.every((l) => l.grade === "best");
  return Number(pct) >= 99.95;
}

// ---------- Ranked ladder ----------
// SR moves by how your pick accuracy compares with what's expected at your level.
export const TIERS = [
  { key: "rookie", name: "Rookie", min: 0 }, { key: "starter", name: "Starter", min: 600 },
  { key: "probowl", name: "Pro Bowl", min: 1200 }, { key: "allpro", name: "All-Pro", min: 1600 },
  { key: "mvp", name: "MVP", min: 2000 }, { key: "hof", name: "Hall of Fame", min: 2500 },
];
export const PLACEMENT_GAMES = 5;
export function tierFor(sr) {
  let i = TIERS.length - 1; while (i > 0 && sr < TIERS[i].min) i--;
  const t = TIERS[i], next = TIERS[i + 1];
  if (!next) return { key: t.key, name: t.name, div: null, label: t.name, floor: t.min, ceil: null, rank: i };
  const width = (next.min - t.min) / 3, d = Math.min(2, Math.floor((sr - t.min) / width));
  const floor = Math.round(t.min + d * width), ceil = Math.round(t.min + (d + 1) * width);
  return { key: t.key, name: t.name, div: ["III", "II", "I"][d], label: `${t.name} ${["III", "II", "I"][d]}`, floor, ceil, rank: i * 3 + d };
}
// accuracy needed to hold your SR. Steep at the top: Hall of Fame (2,500) needs ~96.5% every game.
export function expectedPct(sr) {
  const pts = [[0, 60], [1000, 80], [1600, 88], [2000, 92.5], [2500, 96.5], [3000, 99]];
  if (sr >= 3000) return 99;
  for (let i = 1; i < pts.length; i++) if (sr <= pts[i][0]) { const [a, pa] = pts[i - 1], [b, pb] = pts[i]; return pa + ((sr - a) / (b - a)) * (pb - pa); }
}
export const PLACEMENT_CEILING = 1999; // placements can't put you above All-Pro
export function srChange(sr, pct, gamesBefore) {
  const placing = gamesBefore < PLACEMENT_GAMES;
  const diff = pct - expectedPct(sr);
  // gains shrink at the top of the ladder; losses don't
  const k = placing ? 16 : diff > 0 && sr >= 2000 ? 5 : 8, cap = placing ? 120 : 60;
  let d = Math.max(-cap, Math.min(cap, Math.round(k * diff)));
  if (placing && sr + d > PLACEMENT_CEILING) d = Math.max(0, PLACEMENT_CEILING - sr);
  return d;
}

// ---------- weeks + streaks ----------
const dayAdd = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
// Weeks run Tuesday to Monday, like the NFL week (new week the day after Monday Night Football).
export function weekStart(date) {
  const dow = new Date(date + "T12:00:00Z").getUTCDay(); // 0 Sun .. 6 Sat
  return dayAdd(date, -((dow + 5) % 7)); // back to the most recent Tuesday
}
// Daily streak with one automatic streak freeze per week: a single missed day is covered if that
// week's freeze is still unused. Covered days keep the streak alive but don't add to it.
export function streaks(dates, today) {
  const set = new Set(dates);
  if (!set.size) return { current: 0, best: 0, playedToday: false, freezeLeft: true, savedOn: null };
  let d = [...set].sort()[0], run = 0, best = 0, savedOn = null, thisRun = [];
  const used = new Set();
  for (; d <= today; d = dayAdd(d, 1)) {
    if (set.has(d)) { run++; best = Math.max(best, run); continue; }
    if (d === today) break; // today isn't over yet
    const wk = weekStart(d);
    if (run > 0 && !used.has(wk)) { used.add(wk); thisRun.push(wk); savedOn = d; continue; }
    // streak ends; freezes spent on it didn't save anything, so give them back
    for (const w of thisRun) used.delete(w);
    run = 0; savedOn = null; thisRun = [];
  }
  return { current: run, best, playedToday: set.has(today), freezeLeft: !used.has(weekStart(today)), savedOn: run ? savedOn : null };
}

