// Ranked SR balance simulator. Real rosters, five skill levels, players use their spins.
// Test the live rules: node --experimental-strip-types scripts/ranked_sim.mjs file://$PWD/supabase/functions/game/game.ts "[]" 800 80 150 real
// Try a new curve:   ... ranked_sim.mjs <game.ts url> "[[0,58],[850,72.5],...]" <startSR> [players] [games]
const G = await import(process.argv[2]);
const CURVE = JSON.parse(process.argv[3]), START = +process.argv[4], PLAYERS = +(process.argv[5] || 40), GAMES = +(process.argv[6] || 120), REAL = process.argv[7] === "real";
const { SLOTS, slotAccepts, rollQueue, getRoll, visible, optimalLineup, gradePick, record, tierFor, rerollKey, seasonBonus } = G;
const PLACEMENT_GAMES = 5, CEIL = 1999;
function expected(sr) { if (sr >= CURVE[CURVE.length - 1][0]) return CURVE[CURVE.length - 1][1]; for (let i = 1; i < CURVE.length; i++) if (sr <= CURVE[i][0]) { const [a, pa] = CURVE[i - 1], [b, pb] = CURVE[i]; return pa + ((sr - a) / (b - a)) * (pb - pa); } }
function change(sr, pct, gb, wins) {
  if (REAL) return G.srChange(sr, pct, gb, wins);
  const placing = gb < PLACEMENT_GAMES, diff = pct - expected(sr);
  const k = placing ? 16 : diff > 0 && sr >= 2000 ? 5 : 8, cap = placing ? 120 : 60;
  let d = Math.max(-cap, Math.min(cap, Math.round(k * diff))) + seasonBonus(wins);
  if (placing && sr + d > CEIL) d = Math.max(0, CEIL - sr);
  return d;
}
const SKILLS = [["Casual fan", 1.0], ["Average", 0.65], ["Good", 0.42], ["Expert", 0.26], ["Elite", 0.14]];
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function playGame(sigma) {
  const seed = "sim-" + Math.random(), q = rollQueue(seed, 11); const open = new Set(SLOTS), taken = new Set(), used = [], picks = [];
  const spins = { team: 1, year: 1 }; let qi = 0;
  while (open.size) {
    let key = q[qi];
    const look = (k) => getRoll(k).players.filter((p) => visible(p, { deep: true }) && !taken.has(p.id) && [...open].some((s) => slotAccepts(s, p.pos)))
      .map((p) => ({ p, v: Math.max(p.pts, 1) * Math.exp(sigma * gauss()) })).sort((a, b) => b.v - a.v);
    let cands = look(key);
    // like a real player: if nobody on this roll looks good for an open spot, burn a spin
    for (const kind of ["team", "year"]) {
      if (spins[kind] && (!cands.length || cands[0].v < 170)) {
        const nk = rerollKey(key, kind, `${seed}|${picks.length}|${kind}`, new Set([...used, ...q.slice(qi + 1)]));
        if (nk) { key = nk; q[qi] = nk; spins[kind]--; cands = look(key); }
      }
    }
    qi++;
    if (!cands.length) continue;
    const best = cands[0].p;
    const slot = [...open].find((s) => s !== "FLEX" && slotAccepts(s, best.pos)) || "FLEX";
    const { grade } = gradePick(key, slot, best, taken);
    open.delete(slot); taken.add(best.id); used.push(key); picks.push({ pts: best.pts, grade });
  }
  const total = picks.reduce((a, p) => a + p.pts, 0), opt = optimalLineup(used).total;
  return { pct: Math.round((total / opt) * 1000) / 10, wins: record(total, picks.every((p) => p.grade === "best")).wins };
}
const tiers = ["Rookie", "Starter", "Pro Bowl", "All-Pro", "MVP", "Hall of Fame"];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
for (const [name, base] of SKILLS) {
  const pcts = [], at = {}, hit = Object.fromEntries(tiers.map((t) => [t, []])), firstDelta = [];
  for (const g of [3, 10, 25, 50, 100, GAMES]) at[g] = [];
  for (let n = 0; n < PLAYERS; n++) {
    const sigma = base * (0.85 + Math.random() * 0.3); let sr = START; const h = {};
    for (let gi = 0; gi < GAMES; gi++) {
      const r = playGame(sigma); pcts.push(r.pct);
      const d = change(sr, r.pct, gi, r.wins); if (gi < 5) firstDelta.push(d);
      sr = Math.max(0, sr + d); const t = tierFor(sr).name; if (!(t in h)) h[t] = gi + 1;
      if (at[gi + 1]) at[gi + 1].push(sr);
    }
    for (const t of tiers) if (h[t]) hit[t].push(h[t]);
  }
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const ups = firstDelta.filter((d) => d > 0).length / firstDelta.length;
  console.log(`${name.padEnd(11)} acc ${mean.toFixed(1)}% | placement games that gain SR: ${Math.round(ups * 100)}% | SR@ ` + Object.entries(at).map(([g, v]) => `${g}:${tierFor(med(v)).label}(${med(v)})`).join(" "));
  console.log(`${"".padEnd(11)} reach: ` + tiers.slice(2).map((t) => `${t} ${Math.round(hit[t].length / PLAYERS * 100)}%${hit[t].length ? `@${med(hit[t])}g` : ""}`).join(" | "));
}
