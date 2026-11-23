globalThis.__SE_LAUNCH = "2026-11-01";
const { handle } = await import("./api2.bundle.mjs");
const { memStore } = await import("./memstore.mjs");
const db = memStore();
let fails = 0; const check = (l, c, x = "") => { if (!c) fails++; console.log(c ? "PASS" : "FAIL", l, x); };
const call = (auth, body) => handle({ auth, db, body });
const ACC = { QB: ["QB"], RB1: ["RB"], RB2: ["RB"], WR1: ["WR"], WR2: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"] };
const u = { id: "u1", email: "a@x" }, v = { id: "u2", email: "b@x" };
await call(u, { action: "setUsername", username: "Alpha" });
let g = (await call(u, { action: "start", mode: "daily" })).body;
// 1x1 png
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let r = await call(u, { action: "uploadCard", game: g.id, png }); check("card refused before game finishes", r.status === 404, r.body.error);
while (g.status === "active") { const open = g.slots.filter((s) => !g.picks.some((p) => p.slot === s)); for (const s of open) { const c = g.roll.players.filter((p) => ACC[s].includes(p.pos) && !p.taken); if (c.length) { g = (await call(u, { action: "pick", game: g.id, player: c[0].id, slot: s })).body; break; } } }
r = await call(v, { action: "uploadCard", game: g.id, png }); check("someone else can't upload your card", r.status === 403, r.body.error);
r = await call(u, { action: "uploadCard", game: g.id, png }); check("Daily card refused (would spoil the lineup)", r.status === 400, r.body.error);
// a Casual game's card still uploads for link previews
g = (await call(u, { action: "start", mode: "casual" })).body;
while (g.status === "active") { const open = g.slots.filter((s) => !g.picks.some((p) => p.slot === s)); for (const s of open) { const c = g.roll.players.filter((p) => ACC[s].includes(p.pos) && !p.taken); if (c.length) { g = (await call(u, { action: "pick", game: g.id, player: c[0].id, slot: s })).body; break; } } }
r = await call(u, { action: "uploadCard", game: g.id, png: "data:image/png;base64,aGVsbG8=" }); check("non-PNG rejected", r.status === 400, r.body.error);
r = await call(u, { action: "uploadCard", game: g.id, png }); check("card uploads", r.status === 200 && /cards\/.+\.png/.test(r.body.url), r.body.url);
const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } };
r = await call(u, { action: "savePush", sub }); check("reminder saved", r.status === 200 && db._push().get(sub.endpoint)?.user_id === "u1");
r = await call(null, { action: "savePush", sub: { endpoint: "http://bad", keys: {} } }); check("bad subscription rejected", r.status === 400);
r = await call(u, { action: "deletePush", endpoint: sub.endpoint }); check("reminder removed", r.status === 200 && !db._push().has(sub.endpoint));
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
