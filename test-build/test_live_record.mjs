import { handle } from "../supabase/functions/game/api.ts";
import { memStore } from "./memstore.mjs";

const db = memStore();
const players = [{ id: "host", email: "host@example.test" }, { id: "friend", email: "friend@example.test" }];
for (const p of players) db.T.profiles.set(p.id, { id: p.id, username: p.id, created_at: new Date().toISOString() });
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};
const call = async (auth, action, extra = {}) => {
  const result = await handle({ auth, db, body: { action, ...extra } });
  if (result.status !== 200) throw new Error(`${action} returned ${result.status}: ${result.body.error}`);
  return result.body;
};

let now = Date.now();
const realNow = Date.now;
Date.now = () => now;
try {
  const created = await call(players[0], "liveCreate");
  const joined = await call(players[1], "liveJoin", { id: created.id });
  check("both players joined the match", joined.status === "playing", `status=${joined.status}`);
  now += 4000;

  let finished;
  for (let round = 0; round < 7; round++) {
    for (const player of players) {
      const state = await call(player, "liveState", { id: created.id });
      const positionFits = (slot, pos) => slot === "FLEX" ? ["RB", "WR", "TE"].includes(pos) : slot.replace(/\d/, "") === pos;
      const choice = state.roll.players.flatMap((p) => state.open.filter((slot) => !p.taken && positionFits(slot, p.pos)).map((slot) => ({ player: p, slot })))[0];
      if (!choice) throw new Error(`No eligible pick on round ${round + 1} for ${player.id}`);
      finished = await call(player, "livePick", { id: created.id, player: choice.player.id, slot: choice.slot });
    }
    now += 5000;
  }

  check("live match reaches final result", finished?.status === "done" && finished.result);
  const hostRecord = await call(players[0], "profile");
  const friendRecord = await call(players[1], "profile");
  const winner = finished.result.winner;
  check("match outcome is recorded for the host", hostRecord.liveRecord.wins + hostRecord.liveRecord.losses + hostRecord.liveRecord.ties === 1);
  check("match outcome is recorded for the friend", friendRecord.liveRecord.wins + friendRecord.liveRecord.losses + friendRecord.liveRecord.ties === 1);
  check("record matches the final result", winner == null
    ? hostRecord.liveRecord.ties === 1 && friendRecord.liveRecord.ties === 1
    : hostRecord.liveRecord.wins === (winner === 0 ? 1 : 0) && hostRecord.liveRecord.losses === (winner === 1 ? 1 : 0) &&
      friendRecord.liveRecord.wins === (winner === 1 ? 1 : 0) && friendRecord.liveRecord.losses === (winner === 0 ? 1 : 0));
  await call(players[0], "liveState", { id: created.id }); // repeated reads must not double count
  const repeated = await call(players[0], "profile");
  check("re-reading a finished match does not double count", repeated.liveRecord.wins + repeated.liveRecord.losses + repeated.liveRecord.ties === 1);

  const previousTies = repeated.liveRecord.ties;
  await db.recordLiveResults("tie-match", [{ uid: players[0].id }, { uid: players[1].id }], null);
  const tied = await call(players[0], "profile");
  check("tied match increments the tie record", tied.liveRecord.ties === previousTies + 1);
  check("live record has all W-L-T counts", Object.keys(tied.liveRecord).sort().join(",") === "losses,ties,wins");
} finally {
  Date.now = realNow;
}
