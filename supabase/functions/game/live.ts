// @ts-nocheck
// Live head-to-head: two players, the same seven teams, 30 seconds to lock a pick each roll,
// then both picks are revealed together. The server owns the clock: whenever anyone asks about a match,
// rolls whose time ran out are settled first (a missed pick gets the worst player left).
import { SLOTS, slotAccepts, rollQueue, getRoll, visible, publicRoll, reveal, gradePick, optimalLineup, EMOJI, record } from "./game.ts";

export const LIVE = { pickMs: 30000, revealMs: 5000, startMs: 4000, waitMs: 60 * 60 * 1000, rounds: 7 };
const RULES = { deep: false, hints: false }; // Daily-style rosters, no stats
const r1 = (n) => Math.round(n * 10) / 10;
const cleanName = (s) => String(s || "").replace(/[^A-Za-z0-9_ ]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);

// which seat (0 = host, 1 = friend) this request belongs to, or null
function seatOf(m, auth, key) {
  const seats = m.state.seats;
  for (let i = 0; i < 2; i++) {
    const s = seats[i];
    if (!s) continue;
    if (s.uid && auth && s.uid === auth.id) return i;
    if (s.key && key && s.key === key) return i;
  }
  return null;
}
const takenBy = (st, i) => new Set(st.picks[i].map((p) => p.player.id));
const openSlots = (st, i) => SLOTS.filter((s) => !st.picks[i].some((p) => p.slot === s));

// time ran out: the worst player left who fits an open spot
function autoPick(st, i) {
  const roll = getRoll(st.queue[st.round]), taken = takenBy(st, i), open = openSlots(st, i);
  const fits = roll.players.filter((p) => visible(p, RULES) && !taken.has(p.id) && open.some((s) => slotAccepts(s, p.pos)))
    .sort((a, b) => a.pts - b.pts);
  const p = fits[0];
  if (!p) return null;
  return { player: p.id, slot: open.find((s) => s !== "FLEX" && slotAccepts(s, p.pos)) || "FLEX", auto: true };
}

function settleRound(m, base) {
  const st = m.state, rollKey = st.queue[st.round], roll = getRoll(rollKey);
  for (let i = 0; i < 2; i++) {
    const lock = st.pending[i] || autoPick(st, i);
    if (!lock) continue;
    const p = roll.players.find((x) => x.id === lock.player);
    const { grade, best } = gradePick(rollKey, lock.slot, p, takenBy(st, i));
    st.picks[i].push({ slot: lock.slot, rollKey, season: roll.season, team: roll.team, teamName: roll.teamName, player: reveal(p), grade, best, auto: !!lock.auto });
  }
  st.pending = [null, null];
  st.round += 1;
  st.revealUntil = base + LIVE.revealMs;
  if (st.round >= LIVE.rounds) return finishMatch(m);
  st.deadline = st.revealUntil + LIVE.pickMs;
}

function finishMatch(m) {
  const st = m.state, opt = optimalLineup(st.queue);
  const side = (i) => {
    const total = r1(st.picks[i].reduce((a, p) => a + p.player.pts, 0));
    return { total, pct: r1((total / opt.total) * 100), record: record(total, st.picks[i].every((p) => p.grade === "best")), grid: st.picks[i].map((p) => EMOJI[p.grade]).join("") };
  };
  const a = side(0), b = side(1);
  st.result = { sides: [a, b], optimal: opt.total, optimalLineup: opt.lineup, winner: a.total === b.total ? null : a.total > b.total ? 0 : 1 };
  st.deadline = null;
  m.status = "done";
}

// settle every roll whose clock has run out. Returns true if anything changed.
function tick(m, now) {
  let changed = false;
  while (m.status === "playing" && now >= m.state.deadline) { settleRound(m, m.state.deadline); changed = true; }
  return changed;
}

function view(m, i, now) {
  const st = m.state, me = i == null ? null : i;
  const out = {
    id: m.id, status: m.status, you: me, serverNow: now, rounds: LIVE.rounds, pickMs: LIVE.pickMs,
    players: st.seats.map((s) => s && { name: s.name, ready: !!s.ready, guest: !s.uid }),
    expired: m.status === "waiting" && now - Date.parse(m.created_at) > LIVE.waitMs,
  };
  if (me == null) return out; // not in this match: just who's in it
  const totals = st.picks.map((ps) => r1(ps.reduce((a, p) => a + p.player.pts, 0)));
  Object.assign(out, {
    startAt: st.startAt || null, deadline: st.deadline || null, revealUntil: st.revealUntil || null,
    round: st.round, picks: st.picks, totals, result: st.result || null, rematch: st.rematch || null,
    roll: m.status === "playing" ? publicRoll(st.queue[st.round], RULES, takenBy(st, me)) : null,
    open: m.status === "playing" ? openSlots(st, me) : [],
    locked: st.pending[me] ? { slot: st.pending[me].slot, name: getRoll(st.queue[st.round]).players.find((p) => p.id === st.pending[me].player)?.name } : null,
    oppLocked: !!st.pending[1 - me],
  });
  return out;
}

const newState = (seats) => ({ queue: rollQueue(`live-${crypto.randomUUID()}`, LIVE.rounds), seats, round: 0, picks: [[], []], pending: [null, null], startAt: null, deadline: null, revealUntil: null, rematch: null, result: null });

function startIfReady(m, now) {
  const st = m.state;
  if (m.status !== "waiting" || !st.seats[0]?.ready || !st.seats[1]?.ready) return;
  m.status = "playing";
  st.startAt = now + LIVE.startMs;
  st.deadline = st.startAt + LIVE.pickMs;
}

export function liveActions({ fail, needUser }) {
  // read, change, save; if someone else saved in between, read again and redo the change
  async function mutate(db, id, fn) {
    for (let n = 0; n < 5; n++) {
      const m = id && (await db.getMatch(String(id)));
      if (!m) fail(404, "That match link doesn't work. Ask your friend to make a new one.");
      const now = Date.now();
      const ticked = tick(m, now);
      const res = await fn(m, now);
      if (!ticked && !res?.changed) {
        if (m.status === "done") await db.recordLiveResults?.(m.id, m.state.seats, m.state.result?.winner);
        return { m, now, res };
      }
      if (await db.saveMatch(m)) {
        if (m.status === "done") await db.recordLiveResults?.(m.id, m.state.seats, m.state.result?.winner);
        return { m, now, res };
      }
    }
    fail(503, "The match is busy. Try again.");
  }

  return {
    async liveCreate({ auth, db }) {
      const profile = await needUser(auth, db);
      if (Math.random() < 0.05) db.cleanupMatches?.().catch(() => {});
      const m = await db.insertMatch({ host: auth.id, status: "waiting", state: newState([{ uid: auth.id, key: null, name: profile.username, ready: true }, null]) });
      return view(m, 0, Date.now());
    },

    async liveState({ auth, db, body }) {
      const { m, now } = await mutate(db, body.id, () => null);
      return view(m, seatOf(m, auth, body.key), now);
    },

    async liveJoin({ auth, db, body }) {
      // a logged-in friend plays as their account (username needed); a logged-out friend gets a guest key
      const profile = auth ? await needUser(auth, db) : null;
      let key = null;
      const { m, now } = await mutate(db, body.id, (m, now) => {
        const st = m.state;
        let i = seatOf(m, auth, body.key);
        if (i != null && st.seats[i].ready) { key = st.seats[i].key; return null; } // already in
        if (m.status !== "waiting") fail(409, m.status === "done" ? "That match is over." : "That match already started without you.");
        if (now - Date.parse(m.created_at) > LIVE.waitMs) fail(410, "That match link expired. Ask your friend for a new one.");
        if (i == null) {
          if (st.seats[1]) fail(409, "That match is full.");
          key = auth ? null : crypto.randomUUID();
          let name = auth ? profile.username : cleanName(body.name) || "Guest";
          if (name.toLowerCase() === st.seats[0].name.toLowerCase()) name = `${name.slice(0, 14)} 2`;
          st.seats[1] = { uid: auth ? auth.id : null, key, name, ready: true };
        } else {
          st.seats[i].ready = true; key = st.seats[i].key;
        }
        startIfReady(m, now);
        return { changed: true };
      });
      return { ...view(m, seatOf(m, auth, key || body.key), now), key };
    },

    async livePick({ auth, db, body }) {
      const { m, now } = await mutate(db, body.id, (m, now) => {
        const st = m.state, i = seatOf(m, auth, body.key);
        if (i == null) fail(403, "You're not in this match.");
        if (m.status !== "playing") fail(409, m.status === "done" ? "The match is over." : "The match hasn't started yet.");
        if (now < st.startAt || now < (st.revealUntil || 0)) fail(409, "Hold on, the next team isn't up yet.");
        if (st.pending[i]) fail(409, "You already locked a pick for this team.");
        const roll = getRoll(st.queue[st.round]);
        const p = roll.players.find((x) => x.id === body.player && visible(x, RULES));
        if (!p) fail(400, "That player isn't on this team.");
        const slot = body.slot;
        if (!openSlots(st, i).includes(slot)) fail(400, "That lineup spot is already filled.");
        if (!slotAccepts(slot, p.pos)) fail(400, `A ${p.pos} can't go in the ${slot.replace(/\d/, "")} spot.`);
        if (takenBy(st, i).has(p.id)) fail(400, `${p.name} is already in your lineup.`);
        st.pending[i] = { player: p.id, slot };
        if (st.pending[0] && st.pending[1]) settleRound(m, now);
        return { changed: true };
      });
      return view(m, seatOf(m, auth, body.key), now);
    },

    // either player asks for a rematch: a new match with the same two people; the other one taps to accept
    async liveRematch({ auth, db, body }) {
      const old = body.id && (await db.getMatch(String(body.id)));
      if (!old) fail(404, "That match is gone.");
      const i = seatOf(old, auth, body.key);
      if (i == null) fail(403, "You're not in this match.");
      if (old.status !== "done") fail(409, "Finish this match first.");
      if (old.state.rematch) {
        const { m, now } = await mutate(db, old.state.rematch, (m, now) => {
          if (m.status === "waiting" && !m.state.seats[i].ready) { m.state.seats[i].ready = true; startIfReady(m, now); return { changed: true }; }
          return null;
        });
        return { ...view(m, i, Date.now()), key: m.state.seats[i].key };
      }
      const seats = old.state.seats.map((s, j) => ({ ...s, ready: j === i }));
      const fresh = await db.insertMatch({ host: old.host, status: "waiting", state: newState(seats) });
      const { m: o2 } = await mutate(db, old.id, (m) => { if (m.state.rematch) return null; m.state.rematch = fresh.id; return { changed: true }; });
      if (o2.state.rematch !== fresh.id) return liveActions({ fail, needUser }).liveRematch({ auth, db, body }); // the other player beat us to it
      return { ...view(fresh, i, Date.now()), key: seats[i].key };
    },
  };
}
