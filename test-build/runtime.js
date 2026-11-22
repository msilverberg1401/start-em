// Start 'Em test build: the real game API running in the browser, saved to this device.
// Not for production: points are in the page source and nothing is shared between devices.
import "./setlaunch.js";
import { handle } from "../supabase/functions/game/api.ts";
import { rollQueue, getRoll, visible, optimalLineup, todayET, LAUNCH } from "../supabase/functions/game/game.ts";
import { memStore } from "./memstore.mjs";

const KEY = "se_test_db_v1";
const db = memStore();
// restore saved data
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved) for (const [name, v] of Object.entries(saved)) {
    if (Array.isArray(v) && name !== "members") db.T[name] = new Map(v);
    else if (name === "members") db.T.members = v;
  }
} catch {}
const save = () => {
  try {
    const out = {};
    for (const [k, v] of Object.entries(db.T)) out[k] = v instanceof Map ? [...v.entries()] : v;
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {}
};

// fill Dailies with simulated players so the stats screens have data
const SLOTS = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX"];
const acc = (s, p) => s === "FLEX" ? ["RB", "WR", "TE"].includes(p) : s.replace(/\d/, "") === p;
function simulateDay(date, count) {
  const keys = rollQueue(`daily-${date}`).slice(0, 7);
  for (let n = 0; n < count; n++) {
    const uid = `sim-${date}-${n}`, open = new Set(SLOTS), taken = new Set(), picks = [];
    let total = 0;
    const skill = 1 + Math.random() * 3; // higher = leans harder toward big seasons
    keys.forEach((key, i) => {
      const r = getRoll(key);
      const c = r.players.filter((p) => visible(p, { deep: false }) && !taken.has(p.id) && [...open].some((s) => acc(s, p.pos)));
      if (!c.length) return;
      const w = c.map((p) => Math.pow(Math.max(p.pts, 1), skill));
      let x = Math.random() * w.reduce((a, b) => a + b, 0), p = c[0];
      for (let k = 0; k < c.length; k++) { x -= w[k]; if (x <= 0) { p = c[k]; break; } }
      const slot = [...open].find((s) => s !== "FLEX" && acc(s, p.pos)) || "FLEX";
      open.delete(slot); taken.add(p.id); total += p.pts;
      picks.push({ i, rollKey: key, id: p.id, name: p.name, pts: p.pts, slot });
    });
    total = Math.round(total * 10) / 10;
    const pct = Math.round((total / optimalLineup(keys).total) * 1000) / 10;
    db.T.daily.set(`${date}/${uid}`, { play_date: date, user_id: uid, username: `Sim${Math.floor(Math.random() * 9000) + 1000}`, total, pct, grid: "", picks, finished_at: Date.now() + n });
  }
}
function simulateAll() {
  const today = todayET();
  for (let d = today; d >= LAUNCH; d = new Date(Date.parse(d) - 864e5).toISOString().slice(0, 10)) simulateDay(d, 15 + Math.floor(Math.random() * 46));
  save();
}

// fake login: tokens look like test:<uid>:<email>
const SKEY = "se_test_session";
const subs = [];
const getS = () => { try { return JSON.parse(localStorage.getItem(SKEY) || "null"); } catch { return null; } };
const setS = (s) => { try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch {} subs.forEach((f) => f(s ? "SIGNED_IN" : "SIGNED_OUT", s)); };
const sessionFor = (email) => ({ access_token: `test:u-${email.toLowerCase()}:${email.toLowerCase()}`, user: { id: `u-${email.toLowerCase()}` } });
window.supabase = { createClient() { return { auth: {
  getSession: async () => ({ data: { session: getS() } }),
  onAuthStateChange: (f) => { subs.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
  signInWithOtp: async () => ({ error: null }),
  verifyOtp: async ({ email, token }) => /^\d{6,8}$/.test(token) ? (setS(sessionFor(email)), { error: null }) : { error: { message: "bad code" } },
  signInWithOAuth: async () => { setS(sessionFor("google-tester@example.com")); return { error: null }; },
  signOut: async () => setS(null),
} }; } };

// route the app's API calls to the in-browser handler
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  if (typeof url === "string" && url.startsWith("https://test.local/functions/v1/game")) {
    const tok = String(opts.headers?.authorization || "").replace(/^Bearer\s+/i, "");
    const auth = tok.startsWith("test:") ? { id: tok.split(":")[1], email: tok.split(":")[2] } : null;
    const res = await handle({ body: JSON.parse(opts.body || "{}"), auth, db });
    save();
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, opts);
};

window.START_EM_CONFIG = { supabaseUrl: "https://test.local", supabaseAnonKey: "test", siteUrl: "", hashLinks: true };

// small "Test build" panel
window.addEventListener("DOMContentLoaded", () => {
  const css = document.createElement("style");
  css.textContent = `.tb-pill{position:fixed;right:0;top:42%;z-index:60;writing-mode:vertical-rl;transform:rotate(180deg);padding:14px 7px 18px!important;clip-path:polygon(0 0,100% 8px,100% 100%,0 100%)!important;background:#FFD93D;color:#0B1220;font:800 15px "Saira Condensed",sans-serif;font-style:italic;padding:8px 22px 8px 14px;clip-path:polygon(0 0,100% 0,calc(100% - 10px) 100%,0 100%);box-shadow:0 8px 20px rgba(0,0,0,.25);border:0;cursor:pointer}
  .tb-box{position:fixed;right:44px;top:30%;z-index:60;width:min(340px,calc(100% - 28px));background:#fff;color:#0B1220;border-radius:8px;box-shadow:0 20px 50px rgba(11,18,32,.35);overflow:hidden;font:15px/1.45 "Inter Tight",system-ui,sans-serif}
  .tb-box h3{margin:0;padding:14px 16px 12px;background:#0D1A2B;color:#fff;font:900 24px "Saira Condensed",sans-serif;font-style:italic;border-bottom:5px solid #FFD93D}
  .tb-box p{margin:12px 16px;color:#48566B}.tb-box .tb-row{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px 16px}
  .tb-box button{font:800 16px "Saira Condensed",sans-serif;padding:9px 14px;border:0;border-radius:3px;cursor:pointer;background:#0B1220;color:#fff}.tb-box button.alt{background:#fff;color:#0B1220;box-shadow:inset 0 0 0 1.5px #DCE2EB}`;
  document.head.appendChild(css);
  const pill = document.createElement("button"); pill.className = "tb-pill"; pill.textContent = "Test build";
  const box = document.createElement("div"); box.className = "tb-box"; box.hidden = true;
  box.innerHTML = `<h3>Test build</h3>
    <p>Everything saves on this device only. Logins are fake: any email and any 6-digit code work, and "Continue with Google" logs in as a test player.</p>
    <p>To try challenges and groups, finish a game as one player, copy the challenge link or group code, switch players, then paste the link into the address bar or join with the code.</p>
    <div class="tb-row"><button data-sim>Fill with fake players</button><button data-sw>Switch player</button><button class="alt" data-reset>Reset all test data</button></div>
    <p data-simmsg style="margin-top:0"></p>`;
  document.body.append(pill, box);
  pill.onclick = () => { box.hidden = !box.hidden; };
  box.querySelector("[data-sw]").onclick = () => { setS(null); box.hidden = true; };
  box.querySelector("[data-sim]").onclick = () => { simulateAll(); box.querySelector("[data-simmsg]").textContent = "Added fake players to today's Daily and every past Daily. Their results show in the standings and the Daily stats."; };
  box.querySelector("[data-reset]").onclick = () => {
    if (box.dataset.sure !== "1") { box.dataset.sure = "1"; box.querySelector("[data-reset]").textContent = "Tap again to erase everything"; return; }
    try { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); localStorage.removeItem("se_seen_how"); localStorage.removeItem("se_vs"); } catch {}
    location.reload();
  };
});
