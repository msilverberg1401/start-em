(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CFG = window.START_EM_CONFIG;
  const COLORS = window.TEAM_COLORS;
  const tc = (t) => COLORS[t] || ["#334", "#889"];
  const SLOT_LABEL = { QB: "QB", RB1: "RB", RB2: "RB", WR1: "WR", WR2: "WR", TE: "TE", FLEX: "FLEX" };
  const ORDER = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX"];
  const accepts = (slot, pos) => (slot === "FLEX" ? ["RB", "WR", "TE"].includes(pos) : SLOT_LABEL[slot] === pos);
  const SPOT = { WR1: [15, 30], TE: [50, 30], WR2: [85, 30], FLEX: [50, 50], QB: [27, 70], RB1: [73, 70], RB2: [50, 88] };
  const TIER_LABEL = { elite: "Elite year", starter: "Starter", flex: "Flex-worthy", depth: "Depth" };
  const GRADE_COLOR = { best: "var(--best)", close: "var(--close)", miss: "var(--miss)" };
  const EMOJI = { best: "🟩", close: "🟨", miss: "🟥" };
  const SITE_URL = CFG.siteUrl || location.href.split(/[?#]/)[0];

  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  let session = null, me = null, game = null, selected = null, lbTab = "daily", lbGroup = null, lastTotal = 0;

  // ---------- helpers ----------
  async function api(action, extra = {}) {
    const res = await fetch(`${CFG.supabaseUrl}/functions/v1/game`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: CFG.supabaseAnonKey, authorization: `Bearer ${session?.access_token || CFG.supabaseAnonKey}` },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => ({ error: "The server sent back something unexpected. Try again." }));
    if (!res.ok) throw Object.assign(new Error(data.error || "Request failed."), { status: res.status });
    return data;
  }
  // ---------- light / dark ----------
  const isDark = () => document.documentElement.dataset.theme === "dark";
  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0B1626" : "#0D1A2B");
    const b = document.getElementById("themebtn"); if (b) b.textContent = dark ? "☀️ Light mode" : "🌙 Dark mode";
  }
  function toggleTheme() { const dark = !isDark(); try { localStorage.setItem("se_theme", dark ? "dark" : "light"); } catch {} applyTheme(dark); }
  applyTheme(isDark());
  document.getElementById("themebtn")?.addEventListener("click", toggleTheme);
  // follow the device setting live, unless the player picked one
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => { let t = null; try { t = localStorage.getItem("se_theme"); } catch {} if (!t) applyTheme(e.matches); });

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3000);
  }
  // big position tile on the reveal card (no headshots: we can't get one for every player, so nobody gets one)
  const posTile = (pos) => `<span class="face mark" aria-hidden="true">${pos}</span>`;
  const bulbNum = (n, width = 5) => {
    const s = Number(n).toFixed(1);
    const pad = Math.max(0, width - s.replace(".", "").length);
    return `<span class="off">${"8".repeat(pad)}</span>${s}`;
  };
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function countUp(el, from, to, width) {
    const t0 = performance.now(), d = 900;
    const step = (t) => {
      const k = reduceMotion() ? 1 : Math.min(1, (t - t0) / d);
      el.innerHTML = bulbNum(from + (to - from) * (1 - Math.pow(1 - k, 3)), width);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }
  function untilMidnightET() {
    const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const next = new Date(et); next.setHours(24, 0, 0, 0);
    const m = Math.floor((next - et) / 60000);
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  const shortDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const weekEnd = (from) => new Date(Date.parse(from) + 6 * 864e5).toISOString().slice(0, 10);

  const topbar = (right = "") => `
    <header class="appbar"><div class="wrap">
      <a class="wordmark" href="#" data-home>START<span>'EM</span></a>
      <nav class="nav">
        ${right}
        ${canInstall() ? `<button class="navbtn app" data-install>Get the app</button>` : ""}
        <button class="navbtn" data-how>How to play</button>
        ${me?.signedIn ? `<button class="navbtn user" data-account>${esc(me.username || "Finish setup")}</button>` : `<button class="navbtn solid" data-login>Log in</button>`}
      </nav>
    </div></header>`;
  function wireTopbar(confirmLeave) {
    app.querySelectorAll("[data-home]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      if (!confirmLeave) return home();
      if (confirmLeave === "casual") return askConfirm("Quit this game?", "Casual games aren't saved, so your picks so far will be lost.", "Quit game").then((ok) => ok && home());
      askConfirm("Leave this game?", "Daily, Ranked and challenge games are saved, so you can pick them back up from the home page.", "Leave game").then((ok) => ok && home());
    }));
    $("[data-how]")?.addEventListener("click", howToPlay);
    $("[data-install]")?.addEventListener("click", installApp);
    $("[data-login]")?.addEventListener("click", () => loginSheet());
    $("[data-account]")?.addEventListener("click", (e) => (me.username ? accountMenu(e.currentTarget) : usernameSheet()));
  }

  // dropdown under the username in the top bar
  function accountMenu(btn) {
    const open = document.querySelector(".acct-menu");
    if (open) return open.remove();
    const m = document.createElement("div");
    m.className = "acct-menu"; m.setAttribute("role", "menu");
    m.innerHTML = `
      <div class="am-head">Signed in as<b>${esc(me.username)}</b></div>
      <button role="menuitem" data-am="profile">Profile &amp; stats</button>
      <button role="menuitem" data-am="invite">Invite friends</button>
      <button role="menuitem" data-am="theme">${isDark() ? "☀️ Light mode" : "🌙 Dark mode"}</button>
      <button role="menuitem" data-am="out" class="am-out">Log out</button>`;
    const r = btn.getBoundingClientRect();
    m.style.top = `${r.bottom + 8}px`;
    m.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener("click", outside, true); document.removeEventListener("keydown", esc_); };
    const outside = (e) => { if (!m.contains(e.target) && e.target !== btn) close(); };
    const esc_ = (e) => { if (e.key === "Escape") close(); };
    setTimeout(() => { document.addEventListener("click", outside, true); document.addEventListener("keydown", esc_); });
    m.querySelector('[data-am="profile"]').addEventListener("click", () => { close(); profileView(); });
    m.querySelector('[data-am="invite"]').addEventListener("click", () => { close(); inviteFriends(); });
    m.querySelector('[data-am="theme"]').addEventListener("click", () => { close(); toggleTheme(); });
    m.querySelector('[data-am="out"]').addEventListener("click", async () => { close(); await sb.auth.signOut(); });
  }

  async function inviteFriends() {
    const link = (CFG.shareBase || SITE_URL).replace(/\/$/, "") + "/";
    const msg = `Start 'Em 🏈 Seven random NFL teams, start one player from each, see what he really scored. Think you know ball? ${link}`;
    try { if (navigator.share) return await navigator.share({ text: msg, title: "Start 'Em" }); } catch (e) { if (e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(msg); toast("Invite copied. Paste it in the group chat."); } catch { toast(link); }
  }

  // ---------- sheets (modal dialogs) ----------
  function sheet(html, { onClose, wide } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "sheet-wrap";
    const body = html.replace(/^\s*<h2 class="sheet-h">([\s\S]*?)<\/h2>/, (_, t) => `<div class="sheet-top"><h2 class="sheet-h">${t}</h2></div>`);
    wrap.innerHTML = `<div class="sheet ${wide ? "wide" : ""}" role="dialog" aria-modal="true"><button class="sheet-x" aria-label="Close">×</button>${body}</div>`;
    const close = () => { wrap.remove(); document.removeEventListener("keydown", key); onClose?.(); };
    const key = (e) => { if (e.key === "Escape") close(); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    $(".sheet-x", wrap).addEventListener("click", close);
    document.addEventListener("keydown", key);
    document.body.appendChild(wrap);
    setTimeout(() => $("input, .btn", wrap)?.focus(), 30);
    return { el: wrap, close };
  }

  // in-page yes/no dialog (browser confirm() is blocked in some embeds and looks bad everywhere)
  function askConfirm(title, body, yes = "Yes") {
    return new Promise((resolve) => {
      let done = false;
      const s = sheet(`<h2 class="sheet-h">${esc(title)}</h2><p class="sheet-lede">${esc(body)}</p>
        <div class="row2"><button class="btn navy" data-yes>${esc(yes)}</button><button class="btn ghost" data-no>Cancel</button></div>`, { onClose: () => { if (!done) resolve(false); } });
      $("[data-yes]", s.el).addEventListener("click", () => { done = true; s.close(); resolve(true); });
      $("[data-no]", s.el).addEventListener("click", () => { done = true; s.close(); resolve(false); });
    });
  }
  // tier icons (drawn for Start 'Em): football, helmet, star, shield, trophy, crown
  const TIER_ICON = {
    rookie: '<ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/><path d="M8.5 15.5l7-7M10 11l1.5 1.5M11.6 9.4l1.5 1.5M12.4 12.6l1.5 1.5" stroke="var(--tb-bg,#000)" stroke-width="1.3" stroke-linecap="round" fill="none"/>',
    starter: '<path d="M3 13.5C3 8 7 4 12.5 4c4.6 0 8.5 3.4 8.5 8v1.5h-6.2l-.8 2.5H21v2h-7.4l-1 2.7c-.3.8-1.1 1.3-2 1.3H8.8C5.6 22 3 19.3 3 16z"/><circle cx="9" cy="13.5" r="1.6" fill="var(--tb-bg,#000)"/>',
    probowl: '<path d="M12 2.5l2.8 6.1 6.6.7-5 4.5 1.4 6.6L12 17.1l-5.8 3.3 1.4-6.6-5-4.5 6.6-.7z"/>',
    allpro: '<path d="M12 2l8.5 3v6.3c0 5.2-3.6 9.2-8.5 10.7-4.9-1.5-8.5-5.5-8.5-10.7V5z"/><path d="M12 7.2l1.5 3.1 3.4.4-2.5 2.3.7 3.4L12 14.7l-3.1 1.7.7-3.4-2.5-2.3 3.4-.4z" fill="var(--tb-bg,#000)"/>',
    mvp: '<path d="M7 3h10v2h3.5v2.5c0 2.8-2 5-4.6 5.4A5.5 5.5 0 0 1 13 15.8V18h3.5v3h-9v-3H11v-2.2a5.5 5.5 0 0 1-2.9-2.9C5.5 12.5 3.5 10.3 3.5 7.5V5H7zm0 4H5.5v.5c0 1.5.8 2.8 2 3.4A7 7 0 0 1 7 8zm10 0v1c0 1-.2 2-.5 2.9 1.2-.6 2-1.9 2-3.4V7z"/>',
    hof: '<path d="M2.5 7.5l4.8 3.6L12 4l4.7 7.1 4.8-3.6-1.8 10.5H4.3zM4.5 19.5h15V22h-15z"/>',
  };
  const tierBadge = (t, sm = "") => t ? `<span class="tier-badge t-${t.key} ${sm}"><svg viewBox="0 0 24 24" aria-hidden="true">${TIER_ICON[t.key] || ""}</svg>${esc(t.label)}</span>` : "";
  const makeLink = (kind, val) => kind === "c" && CFG.shareBase ? `${CFG.shareBase.replace(/\/$/, "")}/c/${val}` : CFG.hashLinks ? `${SITE_URL}#${kind}-${val}` : `${SITE_URL}${SITE_URL.includes("?") ? "&" : "?"}${kind}=${val}`;

  function howToPlay() {
    localStorage.setItem("se_seen_how", "1");
    sheet(`
      <h2 class="sheet-h">How to play</h2>
      <p class="sheet-lede">Build the highest-scoring full-PPR lineup in NFL history, one random team at a time. Score big with seven perfect picks and your team goes 14-0.</p>
      <ol class="steps">
        <li><b>Roll a team.</b> Each round hands you a random team from a random season, 1999 to 2025. Think 2007 Patriots or 2016 Falcons.</li>
        <li><b>Start one guy.</b> You see the roster's names and positions. No stats. Your football brain is the only cheat sheet.</li>
        <li><b>Put him in a spot.</b> Your lineup is QB, RB, RB, WR, WR, TE and a FLEX (RB, WR or TE). Once a spot is filled it stays filled, so don't burn your RB spot early if a better back might roll later.</li>
        <li><b>Don't like the roll?</b> Hit <b>New team</b> to keep the season but get a different team, or <b>New year</b> to keep the team but get a different season. Ranked and Casual give you one of each. The Daily has none, so everyone plays the same seven teams.</li>
        <li><b>Watch the reveal.</b> His PPR total and points per game flip over. <span class="g best">Green</span> means he was the best pick on that roll for that spot, <span class="g close">yellow</span> means close, <span class="g miss">red</span> means you left points on the table.</li>
      </ol>
      <h3 class="sheet-sub">How you're scored</h3>
      <p>Your <b>season record</b> comes from how many PPR points your lineup scores. Going 14-0 takes a huge total <i>and</i> all seven picks green (the best start on every roll), so a perfect season is rare. How many points it takes is for you to figure out. You also get <b>pick accuracy</b>: your total as a % of the best lineup your teams allowed, which shows how well you played the hand you were dealt. Ranked ratings use pick accuracy, so bad rolls don't sink you there.</p>
      <p>One more rule: you can't start the same player twice, even if he shows up on two different rolls.</p>
      <h3 class="sheet-sub">Modes</h3>
      <dl class="modes-dl">
        <dt>Daily</dt><dd>Same seven teams for everyone, once a day, no rerolls. New one at midnight ET. Some days have a theme: Throwback Thursday (1999–2009 only), Division Sunday (one division), plus specials like the Thanksgiving Daily.</dd>
        <dt>Ranked</dt><dd>The ball-knowledge ladder. Deeper rosters full of backups and one-game guys, one of each reroll, no restarting. Your SR goes up or down each game based on your pick accuracy versus what's expected at your level. Climb from Rookie through Starter, Pro Bowl, All-Pro and MVP. Hall of Fame is for the best of the best.</dd>
        <dt>Casual</dt><dd>Stats on: every player shows how much he got the ball per game (carries, catches, pass attempts) and games played. One of each reroll. No login needed.</dd>
      </dl>
      <h3 class="sheet-sub">Play with friends</h3>
      <p>After any game, hit <b>Challenge a friend</b> to send them your exact seven teams and see who wins head to head. Make a <b>group</b> with a code to get private standings for your league or group chat, next to the global ones.</p>
      <p class="fine">Regular season only. Full PPR: 1 per catch, 1 per 10 rushing or receiving yards, 6 per rushing or receiving TD, 1 per 25 passing yards, 4 per passing TD, −2 per INT or lost fumble. A player's points only count games he played for the team you rolled. Daily and Ranked need a login so the leaderboards stay honest.</p>
      <button class="btn yel big" data-go>Let's play</button>`, { wide: true });
    $("[data-go]").addEventListener("click", () => document.querySelector(".sheet-wrap")?.remove());
  }

  function loginSheet(reason) {
    const s = sheet(`
      <h2 class="sheet-h">Log in</h2>
      <p class="sheet-lede">${esc(reason || "Daily and Ranked need an account so every leaderboard spot belongs to a real person.")}</p>
      <button class="btn google" data-google><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>
      <div class="or"><span>or get a code by email</span></div>
      <form data-email class="stack">
        <label for="em">Email</label>
        <input id="em" type="email" autocomplete="email" required placeholder="you@example.com">
        <button class="btn yel" type="submit">Email me a code</button>
      </form>
      <form data-code class="stack" hidden>
        <label for="code">Enter the 6-digit code we emailed you</label>
        <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8" required placeholder="123456">
        <button class="btn" type="submit">Log in</button>
        <button class="linkbtn" type="button" data-back>Use a different email</button>
      </form>`);
    let email = "";
    $("[data-google]", s.el).addEventListener("click", async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: SITE_URL } });
      if (error) toast(error.message);
    });
    $("[data-email]", s.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      email = $("#em", s.el).value.trim();
      const btn = e.submitter; btn.disabled = true; btn.textContent = "Sending…";
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      btn.disabled = false; btn.textContent = "Email me a code";
      if (error) return toast(error.message);
      $("[data-email]", s.el).hidden = true; $("[data-code]", s.el).hidden = false; $("#code", s.el).focus();
      toast(`Code sent to ${email}. Check spam if it's not there in a minute.`);
    });
    $("[data-code]", s.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.verifyOtp({ email, token: $("#code", s.el).value.trim(), type: "email" });
      if (error) return toast("That code didn't work. Check it, or send a new one.");
      s.close();
    });
    $("[data-back]", s.el).addEventListener("click", () => { $("[data-email]", s.el).hidden = false; $("[data-code]", s.el).hidden = true; });
  }

  function usernameSheet() {
    const s = sheet(`
      <h2 class="sheet-h">Pick your username</h2>
      <p class="sheet-lede">This is what shows on the leaderboards. You can't change it later, so make it count.</p>
      <form class="stack" data-un>
        <label for="un">Username</label>
        <input id="un" maxlength="16" autocomplete="off" required placeholder="WaiverWireWizard">
        <p class="hint">3–16 letters, numbers or underscores.</p>
        <button class="btn" type="submit">Save username</button>
      </form>`);
    $("[data-un]", s.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await api("setUsername", { username: $("#un", s.el).value.trim() });
        me.username = r.username; s.close(); toast(`You're on the board as ${r.username}.`); await home(); pendingJoin();
      } catch (err) { toast(err.message); }
    });
  }

  function accountSheet() {
    if (!me.username) return usernameSheet();
    const s = sheet(`
      <h2 class="sheet-h">${esc(me.username)}</h2>
      <p class="sheet-lede">Logged in as ${esc(me.email || "your account")}.</p>
      <button class="btn ghost" data-out>Log out</button>`);
    $("[data-out]", s.el).addEventListener("click", async () => { await sb.auth.signOut(); s.close(); });
  }

  // streak + friends under the Play button
  function pulse() {
    const st = me.streak || {}, f = me.friends || { list: [], played: 0, total: 0 };
    const fire = st.current
      ? `<span class="pl-streak"><b>🔥 ${st.current}</b>-day streak</span>`
      : `<span class="pl-streak">Play today to start a streak 🔥</span>`;
    const freeze = st.savedOn
      ? `<span class="pl-freeze" title="One missed day a week is covered">🧊 Streak freeze saved you on ${new Date(st.savedOn + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}</span>`
      : st.current && st.freezeLeft ? `<span class="pl-freeze" title="If you miss one day this week, your streak is safe">🧊 Streak freeze ready</span>` : "";
    const friends = f.total
      ? `<div class="pl-friends">
          <div class="pl-fh">Friends today <span>${f.played} of ${f.total} played</span></div>
          <div class="pl-row">${f.list.map((x) => x.total == null
            ? `<span class="pl-f idle"><b>${esc(x.username)}</b><i>Not yet</i></span>`
            : `<span class="pl-f"><b>${esc(x.username)}</b><i>${x.total.toFixed(1)} · ${x.record}</i></span>`).join("")}
            ${me.dailyDone ? "" : `<span class="pl-f you"><b>You</b><i>Not yet</i></span>`}</div>
        </div>`
      : `<button class="pl-invite" data-groups>👥 Play with your league: make a group and see each other's scores here</button>`;
    return `<div class="pulse"><div class="pl-top">${fire}${freeze}</div>${friends}</div>`;
  }

  // ================= HOME =================
  async function home() {
    game = null; selected = null;
    try { me = await api("me"); } catch (e) { me = { signedIn: false }; toast(e.message); }
    if (me.signedIn && !me.username) setTimeout(usernameSheet, 50);
    const dailyDone = me.dailyDone, rk = me.ranked;
    app.innerHTML = `
    ${topbar()}
    <div class="wrap">
      <section class="hero">
        <div>
          <h1><span class="k">Seven random NFL teams. Seven picks.</span>Who are you <span class="hl">starting?</span></h1>
          <p>Every roll hands you a team from a random season, 1999 to 2025. Start one player, then find out what he really scored in full PPR. Build the best lineup in history.</p>
          <div class="hero-cta">
            <button class="btn yel big" data-mode="daily" ${dailyDone ? "disabled" : ""}>${dailyDone ? `Daily done: ${dailyDone.pct}%` : me.dailyActive ? `Resume Daily #${me.dailyNumber}` : `Play Daily #${me.dailyNumber ?? ""}`}</button>
            <button class="btn navy big" data-how2>How to play</button>
          </div>
          ${me.signedIn && me.username ? pulse() : ""}
        </div>
      </section>

      <div class="modes">
        <button class="mode daily" data-mode="daily" ${dailyDone ? "disabled" : ""}>
          <div class="ph"><h3>Daily</h3><span class="aside">${me.theme ? "Theme day" : "Once a day"}</span></div>
          ${me.theme ? `<div class="theme-tag">${esc(me.theme.name)}</div>` : ""}
          <p>${me.theme ? `${esc(me.theme.desc)} ` : ""}Same seven teams for everyone today, no rerolls. One shot. Top 10 make the board.</p>
          <div class="foot">${dailyDone ? `<span>Played: ${dailyDone.pct}%${me.streak?.current ? ` · ${me.streak.current}-day streak` : ""}</span><span>Next in ${untilMidnightET()}</span>` : `<span>${me.dailyActive ? "In progress" : me.streak?.current ? `${me.streak.current}-day streak. Keep it going.` : `Daily #${me.dailyNumber ?? ""}`}</span><em>${me.dailyActive ? "Resume" : "Play"}</em>`}</div>
        </button>
        <button class="mode ranked" data-mode="ranked">
          <div class="ph"><h3>Ranked${rk && !rk.placing ? ` <span class="ph-sr">${rk.sr} SR</span>` : ""}</h3><span class="aside">Ball knowledge</span></div>
          <p>Climb the ladder from Rookie to Hall of Fame. Deeper rosters full of traps, one of each reroll, no restarting. Every game moves your SR.</p>
          <div class="foot"><span>${rk && !rk.placing ? tierBadge(rk.tier, "sm") : rk ? `Placement ${rk.games}/${rk.placementTotal}` : "5 placement games"}</span><em>${me.rankedActive ? "Resume" : "Play"}</em></div>
        </button>
        <button class="mode casual" data-mode="casual">
          <div class="ph"><h3>Casual</h3><span class="aside">Stats on</span></div>
          <p>See how much each player got the ball per game and how many games he played. One of each reroll. No login needed.</p>
          <div class="foot"><span>Just for fun</span><em>Play</em></div>
        </button>
      </div>

      <button class="archive-bar" data-archive><b>Missed a day?</b> Play past Dailies. They're unranked, and you'll see how you'd have stacked up.</button>

      <section class="standings">
        <div class="panel">
          <div class="ph"><h2>Standings</h2><span class="aside">Top 10</span></div>
          <div class="scopes">
            <button class="chip" data-scope="" aria-pressed="${!lbGroup}">Global</button>
            ${(me.groups || []).map((gr) => `<button class="chip" data-scope="${gr.id}" aria-pressed="${lbGroup === gr.id}">${esc(gr.name)}</button>`).join("")}
            <button class="chip add" data-groups>${me.groups?.length ? "Manage groups" : "+ Make or join a group"}</button>
          </div>
          <div class="tabs" role="tablist">
            ${[["daily", "Today's Daily"], ["week", "This week"], ["ranked", "Ranked ladder"], ["alltime", "Highest lineups ever"]]
              .map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${lbTab === k}">${l}</button>`).join("")}
          </div>
          <div id="lb"><div class="lb-empty">Loading the standings…</div></div>
        </div>
      </section>
      <p class="foot-note">Stats from nflverse. Not affiliated with the NFL or any fantasy platform.</p>
    </div>`;
    wireTopbar(false);
    $("[data-how2]")?.addEventListener("click", howToPlay);
    $("[data-archive]")?.addEventListener("click", archiveView);
    if (lbGroup && !(me.groups || []).some((x) => x.id === lbGroup)) lbGroup = null;
    app.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
      lbGroup = b.dataset.scope || null; app.querySelectorAll("[data-scope]").forEach((x) => x.setAttribute("aria-pressed", x === b)); loadBoard();
    }));
    app.querySelectorAll("[data-groups]").forEach((b) => b.addEventListener("click", () => groupSheet()));
    app.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => start(b.dataset.mode)));
    app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      lbTab = b.dataset.tab; app.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b)); loadBoard();
    }));
    loadBoard();
    if (!localStorage.getItem("se_seen_how")) howToPlay();
  }

  async function loadBoard() {
    const el = $("#lb"); if (!el) return;
    try {
      const d = await api("leaderboard", { board: lbTab, group: lbGroup });
      if (!d.rows.length) {
        const who = lbGroup ? "in this group" : "";
        el.innerHTML = `<div class="lb-empty">${lbTab === "daily" ? `Nobody ${who} has finished today's Daily yet. Play it and take the top spot.` : lbTab === "week" ? `Nobody ${who} has played a Daily this week yet. The week resets every Tuesday.` : lbTab === "ranked" ? `Nobody ${who} is on the ladder yet. Finish 5 Ranked placement games to show up here.` : `No lineups ${who} yet. Finish a Daily or Ranked game to set the record.`}</div>`;
        return;
      }
      const head = lbTab === "daily" ? "<th class='num'>Points</th><th>Season</th><th class='num hide-sm'>Accuracy</th><th class='hide-sm'>Picks</th>"
        : lbTab === "week" ? "<th class='num'>Points</th><th class='num'>Days</th>"
        : lbTab === "ranked" ? "<th>Tier</th><th class='num'>SR</th><th class='num hide-sm'>Games</th>"
        : "<th class='num'>Points</th><th class='hide-sm'>Lineup</th>";

      el.innerHTML = `<table class="lb"><thead><tr><th>Rank</th><th>Player</th>${head}</tr></thead><tbody>${d.rows.map((r, i) => `
        <tr><td class="rk">${i + 1}</td><td class="nm">${esc(r.username)}</td>${
          lbTab === "daily" ? `<td class="num pts">${r.total.toFixed(1)}</td><td><span class="season-badge sm ${r.record === "14-0" ? "perfect" : ""}">${r.record}</span></td><td class="num hide-sm">${r.pct}%</td><td class="grid hide-sm">${esc(r.grid)}</td>`
          : lbTab === "week" ? `<td class="num pts">${r.total.toFixed(1)}</td><td class="num">${r.days}/7</td>`
          : lbTab === "ranked" ? `<td>${tierBadge(r.tier, "sm")}</td><td class="num pts">${r.sr}</td><td class="num hide-sm">${r.games}</td>`
          : `<td class="num pts">${r.total.toFixed(1)} <span class="season-badge sm ${r.record === "14-0" ? "perfect" : ""}">${r.record}</span></td><td class="hide-sm lineup-cell">${r.lineup.map((l) => `${esc(l.name)} '${String(l.season).slice(2)}`).join(", ")}</td>`
        }</tr>`).join("")}</tbody></table>
        ${lbTab === "week" ? `<p class="lb-note">Every Daily from ${shortDate(d.from)} to ${shortDate(weekEnd(d.from))} added up. Play every day to climb. Resets Tuesday.</p>` : ""}
        ${lbTab === "daily" ? `<p class="lb-note">${d.players} ${lbGroup ? "in this group " : ""}played Daily #${d.number}. Everyone had the same teams, so it's ranked by points.</p>` : ""}`;
    } catch (e) { el.innerHTML = `<div class="lb-empty">Couldn't load the standings. ${esc(e.message)}</div>`; }
  }

  // ================= GAME =================
  async function start(mode, date) {
    if (mode !== "casual" && mode !== "archive" && !me?.signedIn) return loginSheet(`Log in to play ${mode === "daily" ? "the Daily" : "Ranked"}. Casual works without an account.`);
    if (mode !== "casual" && mode !== "archive" && !me.username) return usernameSheet();
    try {
      game = await api("start", { mode, date });
      lastTotal = game.total; selected = null;
      renderGame(true);
      if (game.picks.length) toast("Picking up where you left off.");
    } catch (e) { toast(e.message); }
  }

  const POS_NAME = { QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end" };
  const PC = { QB: "var(--qb)", RB: "var(--rb)", WR: "var(--wr)", TE: "var(--te)" };

  // slot-machine spin on the roll banner: the year and team name are reels that scroll up and stop on the real roll.
  // kind: "both" (new roll), "team" or "year" (rerolls spin only what changed)
  function spinRoll(kind) {
    const chy = $(".chy"), yrEl = $(".chy .yr"), tnEl = $(".chy .tn"), list = $(".list"), rbar = $(".rbar");
    if (!chy || reduceMotion()) return;
    const realYr = yrEl.textContent, realTn = tnEl.textContent, realT1 = chy.style.getPropertyValue("--team");
    const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const years = Array.from({ length: 27 }, (_, i) => String(1999 + i));
    const reel = (el, real, pool, count, dur, delay) => new Promise((done) => {
      const items = Array.from({ length: count }, () => rand(pool.filter((x) => x !== real)));
      items.push(real, rand(pool)); // the real value, plus one spare below it for the landing bounce
      el.innerHTML = `<span class="reel"><span class="reel-strip">${items.map((t) => `<span>${esc(t)}</span>`).join("")}</span></span>`;
      const strip = el.querySelector(".reel-strip");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        strip.style.transition = `transform ${dur}ms cubic-bezier(.15, .9, .25, 1.08) ${delay}ms`;
        strip.style.transform = `translateY(-${count}em)`;
      }));
      setTimeout(() => { el.textContent = real; done(); }, dur + delay + 40);
    });
    chy.classList.add("spinning"); list?.classList.add("spinning"); rbar?.classList.add("spinning");
    if (kind !== "year") chy.style.setProperty("--team", "#0D1A2B");
    const spins = [];
    if (kind !== "team") spins.push(reel(yrEl, realYr, years, 16, 1100, 0));
    if (kind !== "year") spins.push(reel(tnEl, realTn, window.TEAM_NAMES, 22, 1500, kind === "both" ? 150 : 0));
    Promise.all(spins).then(() => {
      chy.style.setProperty("--team", realT1);
      chy.classList.remove("spinning"); chy.classList.add("landed");
      list?.classList.remove("spinning"); rbar?.classList.remove("spinning");
    });
  }

  function renderGame(enter) {
    const g = game;
    if (g.status === "done") return results();
    const [t1, t2] = tc(g.roll.team);
    const filled = Object.fromEntries(g.picks.map((p) => [p.slot, p]));
    const open = g.slots.filter((s) => !filled[s]);
    const usable = (p) => !p.taken && open.some((s) => accepts(s, p.pos));
    const groups = ["QB", "RB", "WR", "TE"].map((pos) => [pos, g.roll.players.filter((p) => p.pos === pos)]);
    const modeName = g.mode === "challenge" ? `Challenge vs ${g.challenge?.opponentName || "a friend"}` : g.mode === "archive" ? `Past Daily #${g.number}` : { daily: `Daily #${g.number}`, ranked: "Ranked", casual: "Casual" }[g.mode];
    const hints = g.rules?.hints;
    const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
    // short enough to stay on one line on a phone: per-game usage only
    const usageText = (p) => !p.u ? "" : p.pos === "QB" ? `${n(p.u.att, "att", "att")} · ${n(p.u.car, "rush", "rush")} /g` : p.pos === "RB" ? `${n(p.u.car, "car", "car")} · ${n(p.u.rec, "rec", "rec")} /g` : `${n(p.u.rec, "catch", "catches")} /g`;
    const targets = selected ? open.filter((s) => accepts(s, selected.pos)) : [];
    const spotChoices = [...new Map(targets.map((s) => [SLOT_LABEL[s], s])).entries()].reverse();
    const counts = { best: 0, close: 0, miss: 0 }; g.picks.forEach((p) => counts[p.grade]++);
    const tally = g.picks.length ? [counts.best && `${counts.best} best`, counts.close && `${counts.close} close`, counts.miss && `${counts.miss} ${counts.miss === 1 ? "miss" : "misses"}`].filter(Boolean).join(", ") : "No picks yet";

    app.innerHTML = `
    ${topbar(`<span class="modetag">${esc(modeName)}</span><button class="navbtn exit" data-home>${g.mode === "casual" ? "Quit" : "Save & exit"}</button>`)}
    <div class="wrap">
      <section class="mbar" aria-label="Score and lineup">
        <div class="mbar-top"><span class="mb-pts"><b id="mtotal">${lastTotal.toFixed(1)}</b> PPR</span><span>Roll <b>${g.rollNumber}/7</b></span><span class="mb-grid">${Array.from({ length: 7 }, (_, i) => `<i class="${g.picks[i] ? g.picks[i].grade : i === g.picks.length ? "now" : ""}"></i>`).join("")}</span></div>
        <div class="chips">${g.slots.map((s) => {
          const p = filled[s];
          if (p) return `<div class="chip-s f" style="--c:${tc(p.team)[0]}"><span class="cs">${SLOT_LABEL[s]}</span><span class="cn">${esc(p.player.name.split(" ").slice(-1)[0])}</span><span class="cp">${p.player.pts.toFixed(0)}</span></div>`;
          if (targets.includes(s)) return `<button class="chip-s t" data-slot="${s}"><span class="cs">${SLOT_LABEL[s]}</span><span class="cn">Tap</span></button>`;
          return `<div class="chip-s"><span class="cs">${SLOT_LABEL[s]}</span><span class="cn">Open</span></div>`;
        }).join("")}</div>
      </section>
      <section class="scorebar">
        <div class="board" aria-label="Scoreboard">
          <div class="cell total"><div class="lbl">Total PPR</div><div class="bulbs" id="total">${bulbNum(lastTotal)}</div></div>
          <div class="cell"><div class="lbl">Roll</div><div class="bulbs">${g.rollNumber}/7</div></div>
          <div class="cell"><div class="lbl">New team</div><div class="bulbs">${g.rerolls.team}</div></div>
          <div class="cell"><div class="lbl">New year</div><div class="bulbs">${g.rerolls.year}</div></div>
        </div>
        <div class="prog">
          <div class="txt"><span>Your picks so far</span><b>${tally}</b></div>
          <div class="steps7">${Array.from({ length: 7 }, (_, i) => `<i class="${g.picks[i] ? g.picks[i].grade : i === g.picks.length ? "now" : ""}"></i>`).join("")}</div>
          <div class="txt"><span>${g.picks.length} of 7 spots filled</span><span>${7 - g.picks.length} ${7 - g.picks.length === 1 ? "roll" : "rolls"} left</span></div>
        </div>
      </section>

      <div class="play">
        <section aria-live="polite">
          <div class="chy ${enter ? "enter" : ""}" style="--team:${t1};--team-2:${t2}">
            <span class="tag">Roll ${g.rollNumber} of 7</span>
            <div class="slab"><span class="yr">${g.roll.season}</span><span class="tn">${esc(g.roll.teamName)}</span></div>
            <div class="strip"></div>
          </div>
          ${g.mode === "daily" || g.mode === "archive" || (g.mode === "challenge" && g.rules?.sourceMode === "daily")
            ? `<div class="rbar none">${g.theme ? `<b class="theme-inline">${esc(g.theme.name)}</b> ${esc(g.theme.desc)} ` : ""}No rerolls in the Daily.</div>`
            : `<div class="rbar">
              <div class="rseg"><span class="rk">Swap the team, keep ${g.roll.season}</span><button class="btn ghost" data-reroll="team" ${g.rerolls.team ? "" : "disabled"} title="Same season, different team">New team <i>${g.rerolls.team}</i></button></div>
              <div class="rseg"><span class="rk">Swap the year, keep the ${esc(g.roll.teamName.split(" ").slice(-1)[0])}</span><button class="btn ghost" data-reroll="year" ${g.rerolls.year ? "" : "disabled"} title="Same team, different season">New year <i>${g.rerolls.year}</i></button></div>
            </div>`}
          <div class="list">
            <div class="sub">${hints ? "Stats on: how much the ball came his way each game, and games played. Yards and touchdowns are up to you." : g.rules?.deep ? "Deep roster. Pick one player. His stats stay hidden until he's in your lineup." : "Pick one player. His stats stay hidden until he's in your lineup."}</div>
            ${groups.map(([pos, ps]) => !ps.length ? "" : !open.some((s) => accepts(s, pos)) ? `<h4 class="filled-pos">${POS_NAME[pos]} <span>${pos} spot${pos === "RB" || pos === "WR" ? "s" : ""} filled</span></h4>` : `<h4>${POS_NAME[pos]}</h4>${ps.map((p) => `
              <button class="prow" style="--pc:${PC[pos]}" data-pid="${esc(p.id)}" aria-pressed="${selected?.id === p.id}" ${usable(p) ? "" : "disabled"}>
                <span><span class="nm">${esc(p.name)}</span>${p.taken ? `<span class="meta"><br>Already in your lineup</span>` : hints ? ` <span class="gms">${p.g} ${p.g === 1 ? "game" : "games"}</span><br><span class="usage">${usageText(p)}</span>` : usable(p) ? "" : `<span class="meta"><br>${pos} spot filled</span>`}</span>
                <span class="pos p-${pos}">${pos}</span>
                <span class="go">Start</span>
              </button>`).join("")}`).join("")}
            ${selected ? `<div class="list-foot">
              <span>Where does ${esc(selected.name)} start?</span>
              <span class="spot-picks">${spotChoices.map(([l, s]) => `<button class="btn yel" data-place="${s}">${l}</button>`).join("")}</span>
            </div>` : ""}
          </div>
        </section>

        <section class="turf lineup" aria-label="Your lineup">
          <div class="ph"><h2>Your lineup</h2><span class="aside">${g.picks.length} of 7 filled</span></div>
          ${g.slots.map((s) => {
            const p = filled[s];
            if (p) return `<div class="slot f ${p === g.picks[g.picks.length - 1] && !enter ? "just" : ""}" style="--c:${tc(p.team)[0]}"><span class="s ${s === "FLEX" ? "sm" : ""}">${SLOT_LABEL[s]}</span><span class="p"><div class="nm"><span class="dot d-${p.grade}"></span>${esc(p.player.name)}</div><div class="meta">${p.season} ${esc(p.teamName)} · ${p.player.pos}${p.player.rank}</div></span><span class="pt">${p.player.pts.toFixed(1)}</span></div>`;
            if (targets.includes(s)) return `<button class="slot t" data-slot="${s}"><span class="s ${s === "FLEX" ? "sm" : ""}">${SLOT_LABEL[s]}</span><span class="p"><div class="nm">Start ${esc(selected.name.split(" ").slice(-1)[0])} here</div></span><span class="pt">Tap</span></button>`;
            return `<div class="slot"><span class="s ${s === "FLEX" ? "sm" : ""}">${SLOT_LABEL[s]}</span><span class="p"><div class="meta">${s === "FLEX" ? "Open · RB, WR or TE" : "Open"}</div></span><span></span></div>`;
          }).join("")}
        </section>
      </div>
    </div>`;

    // casual: leave freely before the first pick, confirm after (nothing is saved). Others are saved and resumable.
    wireTopbar(g.mode !== "casual" ? true : g.picks.length ? "casual" : false);
    if (enter) {
      window.scrollTo({ top: 0, behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
      spinRoll(typeof enter === "string" ? enter : "both");
    }
    app.querySelectorAll(".prow").forEach((b) => b.addEventListener("click", () => {
      const p = g.roll.players.find((x) => x.id === b.dataset.pid);
      selected = selected?.id === p.id ? null : p;
      const spots = selected ? open.filter((s) => accepts(s, p.pos)) : [];
      if (spots.length === 1) return pick(spots[0]);
      renderGame(false);
      if (spots.length) $("[data-place]")?.focus({ preventScroll: true });
    }));
    app.querySelectorAll("[data-place], button.slot.t, button.chip-s.t").forEach((b) => b.addEventListener("click", () => pick(b.dataset.place || b.dataset.slot)));
    app.querySelectorAll("[data-reroll]").forEach((b) => b.addEventListener("click", async () => {
      const kind = b.dataset.reroll;
      if (!g.rerolls[kind]) return;
      try {
        game = await api("reroll", { game: g.id, kind }); selected = null; renderGame(kind);
      } catch (e) { toast(e.message); }
    }));
  }

  let picking = false;
  const uploaded = new Set();
  async function pick(slot) {
    const p = selected; if (!p || picking) return;
    picking = true;
    try {
      const r = await api("pick", { game: game.id, player: p.id, slot });
      const prev = lastTotal;
      game = r; selected = null;
      showReveal(r.lastPick, prev);
    } catch (e) { toast(e.message); }
    finally { picking = false; }
  }

  function showReveal(pk, prevTotal) {
    const [t1, t2] = tc(pk.team);
    const pl = pk.player;
    const verdict = pk.grade === "best" ? "Best start on the roll for that spot."
      : `${esc(pk.best.name)} had ${pk.best.pts.toFixed(1)} for this spot. ${pk.grade === "close" ? "Close." : "That one hurts."}`;
    const ov = document.createElement("div");
    ov.className = "reveal-wrap";
    ov.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="${esc(pl.name)} scored ${pl.pts} points" style="--team:${t1};--team-2:${t2}">
      <div class="card-top">${posTile(pl.pos)}<div><div class="nm">${esc(pl.name)}</div><div class="sub">${pk.season} ${esc(pk.teamName)} · ${pk.slot === "FLEX" ? `FLEX (${pl.pos})` : pl.pos}</div></div></div>
      <div class="card-pts"><div class="big" id="cardpts">0.0</div><div class="unit">PPR points</div></div>
      <div class="card-stats">
        <div><b>${pl.ppg.toFixed(1)}</b>Per game</div>
        <div><b>${pl.g}</b>Games</div>
        <div><b>${pl.pos}${pl.rank}</b>Finish</div>
      </div>
      <div class="verdict ${pk.grade}">${verdict}</div>
      <button class="btn" id="next">${game.status === "done" ? "See your season" : "Next roll"}</button>
    </div>`;
    document.body.appendChild(ov);
    const big = $("#cardpts", ov), t0 = performance.now();
    (function tick(t) { const k = reduceMotion() ? 1 : Math.min(1, (t - t0) / 800); big.textContent = (pl.pts * (1 - Math.pow(1 - k, 3))).toFixed(1); if (k < 1) requestAnimationFrame(tick); })(t0);
    const go = () => {
      ov.remove(); document.removeEventListener("keydown", key);
      renderGame(true);
      const el = $("#total"); if (el) countUp(el, prevTotal, game.total);
      lastTotal = game.total;
    };
    const key = (e) => { if (e.key === "Enter" || e.key === "Escape") go(); };
    $("#next", ov).addEventListener("click", go); $("#next", ov).focus();
    document.addEventListener("keydown", key);
  }

  // ================= RESULTS: matchup =================
  async function results() {
    const g = game, r = g.result;
    const bySlot = (arr) => Object.fromEntries(arr.map((x) => [x.slot, x]));
    const mine = bySlot(g.picks), perf = bySlot(r.optimalLineup);
    const verdict = r.record.wins === 14 ? "Perfect season. Frame it." : r.record.wins >= 11 ? "Playoff lock." : r.record.wins >= 8 ? "Playoff bubble." : r.record.wins >= 5 ? "Consolation bracket." : "Top pick in next year's draft.";
    const modeName = g.mode === "daily" ? `Daily #${g.number}` : g.mode === "archive" ? `Past Daily #${g.number}` : g.mode === "ranked" ? "Ranked" : g.mode === "challenge" ? "Challenge" : "Casual";
    let opp = g.challenge?.opponent || null;
    if (!opp && g.mode === "daily") {
      const vs = JSON.parse(localStorage.getItem("se_vs") || "null");
      if (vs && vs.date === g.date) { try { opp = await api("challengeInfo", { id: vs.id }); } catch {} }
    }
    app.innerHTML = `
    ${topbar(`<span class="modetag">${esc(modeName)}</span>`)}
    <div class="wrap">
      ${opp ? h2hPanel(r, opp) : ""}
      <section class="panel matchup">
        <div class="mhead">
          <div class="mmain">
            <div class="who">Your score</div>
            <div class="board"><div class="bulbs" id="final">${bulbNum(reduceMotion() ? r.total : 0, 5)}</div></div>
            <div class="badge-row"><span class="season-badge ${r.record.wins === 14 ? "perfect" : ""}">${r.record.wins}-${r.record.losses} season</span><span class="verdict-line">${verdict}</span></div>
          </div>
          <div class="mside perf"><div class="who">Perfect lineup from your teams</div><div class="score">${r.optimal.toFixed(1)}</div></div>
        </div>
        <div class="pctbar">
          <div class="txt"><span>Pick accuracy <b>${r.pct}%</b> of the best lineup your teams allowed</span><span>${r.record.wins === 14 ? "Perfect season." : ""}</span></div>
          <div class="track"><div class="fill" id="fill"></div></div>
        </div>
        <div class="quick-share">
          <button class="btn yel big" id="share">Share result</button>
          <button class="btn navy big" id="challenge">Challenge a friend</button>
        </div>
      </section>

      ${r.ranked ? srPanel(r.ranked) : ""}

      <section class="panel matchup picks">
        <div class="ph"><h2>Your picks vs the perfect lineup</h2><span class="aside">You · Best on each roll</span></div>
        <div class="turf field-rows">
        ${ORDER.map((s) => {
          const a = mine[s], b = perf[s];
          const same = a.player.id === b.player.id;
          return `<div class="mrow">
            <div class="pl"><div><div class="nm"><span class="dot d-${a.grade}"></span>${esc(a.player.name)}</div><div class="yr">${a.season} ${esc(a.team)} <b>· ${a.player.pts.toFixed(1)}</b></div></div></div>
            <span class="pt ${same ? "same" : ""}">${a.player.pts.toFixed(1)}</span>
            <span class="mid"><span class="pos p-${SLOT_LABEL[s]}">${SLOT_LABEL[s]}</span></span>
            <span class="pt r">${b.player.pts.toFixed(1)}</span>
            <div class="pl r"><div><div class="nm">${esc(b.player.name)}</div><div class="yr">${b.season} ${esc(b.rollKey.split("-")[1])} <b>· ${b.player.pts.toFixed(1)}</b></div></div></div>
          </div>`;
        }).join("")}
        </div>
        <div class="callouts">
            <div class="callout good"><span>Best start</span><b>${esc(r.bestPick.name)}</b>, ${r.bestPick.pts.toFixed(1)} pts (${r.bestPick.season} ${esc(r.bestPick.team)})</div>
            ${r.biggestMiss ? `<div class="callout bad"><span>Biggest miss</span><b>${esc(r.biggestMiss.name)}</b> over ${esc(r.biggestMiss.instead)} cost you ${r.biggestMiss.lost.toFixed(1)}</div>` : `<div class="callout good"><span>Biggest miss</span>None. Every pick was the best on its roll.</div>`}
          </div>
      </section>

      <div class="after">
        <div class="share-card"><img id="shareimg" alt="Your shareable Start 'Em result card"></div>
        <div class="share-side">
          <h3>Your card</h3>
          <p>Save it for your story, or copy the text for a group chat${g.mode === "daily" ? ". A challenge link sends friends to today's Daily" : ""}.</p>
          ${StartEmShare.canVideo() ? `<button class="btn yel" id="makevideo"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2"></rect><path d="M16 10l6-3v10l-6-3z"></path></svg>Make a video for TikTok or Reels</button>` : ""}
          <div class="share-more">
            <button class="btn ghost" id="copytext">Copy text</button>
            <button class="btn ghost" id="saveimg">Save image</button>
          </div>
        </div>
      </div>

      ${g.mode === "daily" || g.mode === "archive" ? `<section class="panel dstats" id="dstats"><div class="ph"><h2>How everyone played Daily #${g.number}</h2><span class="aside">Loading…</span></div></section>` : ""}
      ${g.mode === "daily" ? reminderBar() : ""}

      <div class="res-actions">
        ${g.mode === "ranked" || g.mode === "casual" ? `<button class="btn navy big" id="again">Play ${g.mode} again</button>` : g.mode === "archive" || g.mode === "daily" ? `<button class="btn navy big" id="morepast">Play past Dailies</button>` : ""}
        <button class="btn ghost" id="back">Back to standings</button>
      </div>
    </div>`;
    wireTopbar(false);
    requestAnimationFrame(() => { const f = $("#fill"); if (f) f.style.width = `${Math.min(100, r.pct)}%`; });
    if (!reduceMotion()) countUp($("#final"), 0, r.total, 5);
    $("#back").addEventListener("click", home);
    $("#again")?.addEventListener("click", () => start(g.mode));
    $("#morepast")?.addEventListener("click", archiveView);
    wireReminder();
    setTimeout(maybeAskReminders, 2500);
    if (g.mode === "daily" || g.mode === "archive") loadDailyStats(g);
    const shareLink = makeLink("c", g.id);
    const text = StartEmShare.text({ game: g, url: shareLink });
    const card = await StartEmShare.draw({ game: g, url: CFG.shareBase || SITE_URL, teamColors: COLORS });
    // save the card online so the challenge link's preview can show it (fire and forget)
    if (!uploaded.has(g.id)) { uploaded.add(g.id); api("uploadCard", { game: g.id, png: card.dataUrl }).catch(() => {}); }
    $("#shareimg").src = card.dataUrl;
    const file = new File([card.blob], `start-em-${g.mode}${g.number ? `-${g.number}` : ""}.png`, { type: "image/png" });
    const copyText = async () => {
      try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in the group chat."); }
      catch { toast("Couldn't reach the clipboard in this browser."); }
    };
    const saveImg = () => { const a = document.createElement("a"); a.href = card.dataUrl; a.download = file.name; a.click(); };
    $("#copytext").addEventListener("click", copyText);
    $("#saveimg").addEventListener("click", saveImg);
    $("#challenge").addEventListener("click", async () => {
      const link = makeLink("c", g.id);
      const msg = `I put up ${r.total.toFixed(1)} PPR (${r.record.wins}-${r.record.losses} season) on Start 'Em. Same seven teams, can you beat me? ${link}`;
      try { if (navigator.share) return await navigator.share({ text: msg, title: "Start 'Em challenge" }); } catch (e) { if (e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(msg); toast("Challenge link copied. Send it to a friend."); } catch { toast(link); }
    });
    $("#makevideo")?.addEventListener("click", () => videoSheet(g, shareLink));
    $("#share").addEventListener("click", () => shareSheet({ card, file, text, copyText, saveImg }));
    $("#shareimg").addEventListener("click", () => shareSheet({ card, file, text, copyText, saveImg }));
  }

  // ================= RANKED LADDER =================
  function srPanel(k) {
    const t = k.tier, inPlacement = k.placement != null;
    const prog = t.ceil ? Math.round(((k.after - t.floor) / (t.ceil - t.floor)) * 100) : 100;
    const banner = k.placed ? `<div class="sr-banner up">Placed in <b>${esc(t.label)}</b>. The climb starts now.</div>`
      : k.moved === "up" ? `<div class="sr-banner up">Promoted to <b>${esc(t.label)}</b>!</div>`
      : k.moved === "down" ? `<div class="sr-banner down">Dropped to <b>${esc(t.label)}</b>. Win it back.</div>` : "";
    return `<section class="panel srp">
      <div class="ph"><h2>Ranked</h2><span class="aside">${inPlacement && !k.placed ? `Placement game ${k.placement} of ${k.placementTotal}` : `${k.games} games played`}</span></div>
      ${banner}
      <div class="sr-body">
        <div class="sr-tier">${tierBadge(t)}<div class="sr-num"><b>${k.after}</b> SR <span class="sr-delta ${k.delta >= 0 ? "up" : "down"}">${k.delta >= 0 ? "+" : ""}${k.delta}</span></div></div>
        <div class="sr-prog">
          <div class="sr-track"><i style="width:${Math.max(2, Math.min(100, prog))}%"></i></div>
          <div class="sr-cap"><span>${t.floor}</span><span>${t.ceil ? `${t.ceil - k.after} SR to ${esc(nextLabel(t))}` : "Top of the ladder"}</span></div>
        </div>
      </div>
    </section>`;
  }
  const TIER_ORDER = ["Rookie", "Starter", "Pro Bowl", "All-Pro", "MVP", "Hall of Fame"];
  function nextLabel(t) {
    if (t.div === "III") return `${t.name} II`;
    if (t.div === "II") return `${t.name} I`;
    const n = TIER_ORDER[TIER_ORDER.indexOf(t.name) + 1];
    return n === "Hall of Fame" ? n : `${n} III`;
  }

  // ================= DAILY STATS =================
  async function loadDailyStats(g) {
    const el = $("#dstats"); if (!el) return;
    let s;
    try { s = await api("dailyStats", { date: g.date, game: g.id }); }
    catch (e) { el.innerHTML = `<div class="ph"><h2>How everyone played Daily #${g.number}</h2></div><div class="lb-empty">${esc(e.message)}</div>`; return; }
    const myWins = g.result.record.wins, maxW = Math.max(1, ...s.wins);
    el.innerHTML = `
      <div class="ph"><h2>How everyone played Daily #${s.number}</h2><span class="aside">${s.theme ? `${esc(s.theme.name)} · ` : ""}${s.players} ${s.players === 1 ? "player" : "players"}</span></div>
      <div class="ds-top">
        <div class="ds-beat">${s.beat == null ? `<b>First!</b><span>You're the first to finish this one. Check back later.</span>` : `<b>${s.beat}%</b><span>${s.archive ? "of that day's players you'd have beaten" : "of today's players you beat"}</span>`}</div>
        <div class="ds-hist" aria-label="How many players finished with each season record">
          ${s.wins.map((n, w) => `<div class="hb ${w === myWins ? "me" : ""}" title="${w}-${14 - w}: ${n}"><i style="height:${Math.round((n / maxW) * 100)}%"></i><span>${w}</span></div>`).join("")}
          <div class="hcap">Season records today${s.archive ? " (that day)" : ""}. Yours is highlighted.</div>
        </div>
      </div>
      ${s.rarest && s.rarest.pct <= 25 ? `<div class="ds-rare">Rarest pick: <b>${esc(s.rarest.name)}</b>. Only ${s.rarest.pct}% started him off the ${s.rarest.season} ${esc(s.rarest.team)}.</div>` : ""}
      <div class="ds-rolls">${s.rolls.map((x) => `
        <div class="ds-roll" style="--c:${tc(x.team)[0]}">
          <div class="ds-team"><b>${x.season}</b> ${esc(x.teamName)}</div>
          <div class="ds-picks">${x.top.map((t) => `<div class="ds-bar ${t.name === x.mine ? "mine" : ""}"><i style="width:${t.pct}%"></i><span>${esc(t.name)}</span><em>${t.pct}%</em></div>`).join("")}
          ${x.mine && !x.top.some((t) => t.name === x.mine) ? `<div class="ds-bar mine"><i style="width:${x.minePct || 0}%"></i><span>${esc(x.mine)} (you)</span><em>${x.minePct ?? 0}%</em></div>` : ""}</div>
        </div>`).join("")}</div>`;
  }

  // ================= PAST DAILIES =================
  async function archiveView() {
    game = null; selected = null;
    let d;
    try { d = await api("archiveList"); } catch (e) { return toast(e.message); }
    const fmt = (s) => new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    app.innerHTML = `
    ${topbar(`<span class="modetag">Past Dailies</span>`)}
    <div class="wrap profile">
      <section class="panel">
        <div class="ph"><h2>Past Dailies</h2><span class="aside">Unranked · no rerolls</span></div>
        <p class="ar-lede">Every Daily you missed, same seven teams everyone else got. They don't count for the standings, but you'll see how you'd have placed that day.</p>
        ${d.days.length ? `<div class="ar-grid">${d.days.map((x) => `
          <button class="ar-day ${x.mine && !x.mine.active ? "done" : ""}" data-day="${x.date}">
            <span class="ar-n">Daily #${x.number}</span>
            <span class="ar-d">${fmt(x.date)}</span>${x.theme ? `<span class="ar-theme">${esc(x.theme.name.replace("Division Sunday: ", ""))}</span>` : ""}
            ${x.mine && !x.mine.active ? `<span class="ar-res"><b>${x.mine.total.toFixed(1)}</b> <span class="season-badge sm">${x.mine.record.wins}-${x.mine.record.losses}</span></span><span class="ar-p">${x.mine.played === "daily" ? "Played that day" : "Played from archive"}</span>`
              : `<span class="ar-p">${x.players} ${x.players === 1 ? "player" : "players"}</span><span class="ar-go">${x.mine?.active ? "Resume" : "Play"}</span>`}
          </button>`).join("")}</div>` : `<div class="lb-empty">No past Dailies yet. Come back tomorrow, and today's Daily will be here.</div>`}
      </section>
      <div class="res-actions"><button class="btn ghost" data-back>Back to home</button></div>
    </div>`;
    wireTopbar(false);
    $("[data-back]").addEventListener("click", home);
    app.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
      const x = d.days.find((y) => y.date === b.dataset.day);
      if (x.mine?.played === "daily") return toast("You played this one the day it came out.");
      start("archive", x.date);
    }));
  }

  // ================= VIDEO FOR TIKTOK / REELS =================
  async function videoSheet(g, link) {
    const s = sheet(`
      <h2 class="sheet-h">Your Start 'Em video</h2>
      <div class="vid-wrap">
        <div class="vid-make"><p class="sheet-lede">Making your 9-second video. Keep this page open.</p><div class="track"><div class="fill" id="vidfill"></div></div></div>
      </div>`, { wide: true });
    const wrap = $(".vid-wrap", s.el);
    let out;
    try {
      out = await StartEmShare.video({ game: g, url: link, teamColors: COLORS, onProgress: (k) => { const f = $("#vidfill", s.el); if (f) f.style.width = `${Math.round(k * 100)}%`; } });
    } catch (e) { wrap.innerHTML = `<p class="sheet-lede">${esc(e.message || "Couldn't make the video here.")}</p>`; return; }
    if (!document.body.contains(s.el)) return; // closed while recording
    const name = `start-em-${g.mode}${g.number ? `-${g.number}` : ""}.${out.ext}`;
    const file = new File([out.blob], name, { type: out.mime });
    const url = URL.createObjectURL(out.blob);
    const canShare = !!navigator.canShare?.({ files: [file] });
    wrap.innerHTML = `
      <video class="vid-prev" src="${url}" autoplay muted loop playsinline></video>
      <div class="vid-acts">
        ${canShare ? `<button class="btn yel big" data-vshare>Share video</button><p class="hint">Pick TikTok, Instagram or Snapchat from your share menu.</p>` : ""}
        <button class="btn ${canShare ? "ghost" : "yel big"}" data-vsave>Save video</button>
        ${out.ext === "webm" ? `<p class="hint">Saved as a .webm file. If an app won't take it, use Save image instead.</p>` : ""}
      </div>`;
    $("[data-vshare]", s.el)?.addEventListener("click", async () => {
      try { await navigator.share({ files: [file], title: "Start 'Em" }); }
      catch (e) { if (e.name !== "AbortError") toast("Couldn't share the video here. Try Save video."); }
    });
    $("[data-vsave]", s.el).addEventListener("click", () => { const a = document.createElement("a"); a.href = url; a.download = name; a.click(); });
  }

  // ================= SHARE POP-UP =================
  function shareSheet({ card, file, text, copyText, saveImg }) {
    const enc = encodeURIComponent(text);
    const canFiles = !!navigator.canShare?.({ files: [file] });
    const s = sheet(`
      <h2 class="sheet-h">Share your lineup</h2>
      <div class="share-pop">
        <img src="${card.dataUrl}" alt="Your Start 'Em result card">
        <div class="share-opts">
          ${navigator.share ? `<button class="btn yel big" data-native>Share</button><p class="hint">Sends your score and link. In chats the link shows your card.</p>` : ""}
          <div class="share-grid">
            <a class="share-app sms" href="sms:?&body=${enc}"><span>Messages</span></a>
            <a class="share-app wa" href="https://wa.me/?text=${enc}" target="_blank" rel="noopener"><span>WhatsApp</span></a>
            <a class="share-app x" href="https://twitter.com/intent/tweet?text=${enc}" target="_blank" rel="noopener"><span>X</span></a>
            <button class="share-app copy" data-copy><span>Copy text</span></button>
          </div>
          ${canFiles ? `<button class="btn navy" data-img>Share image</button><p class="hint">For Instagram and Snapchat stories.</p>` : ""}
          <button class="btn ghost" data-save>Save image</button>
        </div>
      </div>`, { wide: true });
    $("[data-native]", s.el)?.addEventListener("click", async () => {
      try {
        // text + link only: the link preview already shows the card, so attaching it too would show it twice
        await navigator.share({ text, title: "Start 'Em" });
        s.close();
      } catch (e) { if (e.name !== "AbortError") toast("Sharing isn't available here. Try Copy text."); }
    });
    $("[data-img]", s.el)?.addEventListener("click", async () => {
      try { await navigator.share({ files: [file] }); s.close(); }
      catch (e) { if (e.name !== "AbortError") toast("Couldn't share the image here. Try Save image."); }
    });
    $("[data-copy]", s.el).addEventListener("click", copyText);
    $("[data-save]", s.el).addEventListener("click", saveImg);
  }

  // ================= HEAD TO HEAD =================
  function h2hPanel(r, opp) {
    const won = r.total > opp.total, tie = r.total === opp.total;
    const head = tie ? "Dead even." : won ? `You beat ${esc(opp.username)}.` : `${esc(opp.username)} wins this one.`;
    return `<section class="panel h2h">
      <div class="ph"><h2>Head to head</h2><span class="aside">${opp.number ? `Daily #${opp.number}` : "Same seven teams"}</span></div>
      <div class="h2h-body">
        <div class="h2h-side ${won ? "win" : ""}"><div class="who">You</div><div class="score">${r.total.toFixed(1)}</div><div class="rec"><span class="season-badge sm">${r.record.wins}-${r.record.losses}</span> ${r.pct}% accuracy</div></div>
        <div class="h2h-mid">${head}<span>${tie ? "" : `by ${Math.abs(r.total - opp.total).toFixed(1)} points`}</span></div>
        <div class="h2h-side r ${!won && !tie ? "win" : ""}"><div class="who">${esc(opp.username)}</div><div class="score">${opp.total.toFixed(1)}</div><div class="rec"><span class="season-badge sm">${opp.record.wins}-${opp.record.losses}</span> ${opp.pct}% accuracy</div></div>
      </div>
    </section>`;
  }

  async function startChallenge(id) {
    try {
      const r = await api("start", { mode: "challenge", challenge: id });
      if (r.redirectDaily) {
        localStorage.setItem("se_vs", JSON.stringify({ id, date: r.opponent.date }));
        toast(`Play today's Daily to see if you beat ${r.opponent.username}.`);
        return start("daily");
      }
      game = r; lastTotal = r.total; selected = null;
      if (game.challenge) game.challenge.opponentName = challengeName;
      renderGame(true);
    } catch (e) { toast(e.message); home(); }
  }
  let challengeName = null;
  async function challengeIntro(id) {
    let o;
    try { o = await api("challengeInfo", { id }); } catch (e) { toast(e.message); return; }
    challengeName = o.username;
    const today = o.mode === "daily" && o.date === me?.today;
    const rules = o.sourceMode === "ranked" ? "Ranked rules: deep rosters, one of each reroll." : o.sourceMode === "casual" ? "Casual rules: stats on, one of each reroll." : "Daily rules: no rerolls.";
    const s = sheet(`
      <h2 class="sheet-h">You've been challenged</h2>
      <div class="ch-card">
        <div class="board"><div class="bulbs">${o.total.toFixed(1)}</div></div>
        <div><b>${esc(o.username)}</b> put up <b>${o.total.toFixed(1)} PPR</b>, a <b>${o.record.wins}-${o.record.losses}</b> season${o.number ? ` on Daily #${o.number}` : ""}.<div class="grid">${esc(o.grid)}</div></div>
      </div>
      <p class="sheet-lede">${today ? "Play today's Daily and you'll see how you stack up against them." : `You'll get the exact same seven teams. ${rules}`} Their picks stay hidden until you finish.</p>
      <button class="btn yel big" data-accept>Accept the challenge</button>`);
    $("[data-accept]", s.el).addEventListener("click", () => {
      s.close();
      if (today && !me?.signedIn) { localStorage.setItem("se_vs", JSON.stringify({ id, date: o.date })); return loginSheet("Log in to play today's Daily against your friend."); }
      startChallenge(id);
    });
  }

  // ================= GROUPS =================
  function groupSheet(prefill) {
    if (!me?.signedIn) return loginSheet("Log in to make or join a group.");
    if (!me.username) return usernameSheet();
    const groups = me.groups || [];
    const s = sheet(`
      <h2 class="sheet-h">Groups</h2>
      <p class="sheet-lede">Private standings for your league, your team or your group chat. Everyone still shows up on the global board too.</p>
      ${groups.length ? `<div class="glist">${groups.map((gr) => `<div class="gitem"><div><b>${esc(gr.name)}</b><span>${gr.members} ${gr.members === 1 ? "member" : "members"} · code <code>${gr.code}</code></span></div><div class="gact"><button class="btn ghost" data-invite="${gr.code}" data-name="${esc(gr.name)}">Invite</button><button class="linkbtn" data-leave="${gr.id}">Leave</button></div></div>`).join("")}</div>` : ""}
      <form class="stack" data-join>
        <label for="jc">Join with a code</label>
        <div class="row2"><input id="jc" maxlength="6" placeholder="ABC234" value="${esc(prefill || "")}" autocomplete="off" style="text-transform:uppercase"><button class="btn navy" type="submit">Join</button></div>
      </form>
      <form class="stack" data-make style="margin-top:16px">
        <label for="gn">Or start a new group</label>
        <div class="row2"><input id="gn" maxlength="32" placeholder="Sunday Funday League" autocomplete="off"><button class="btn yel" type="submit">Create</button></div>
      </form>`);
    const invite = async (code, name) => {
      const link = makeLink("join", code);
      const msg = `Join "${name}" on Start 'Em and let's see who knows ball: ${link} (code ${code})`;
      try { if (navigator.share) return await navigator.share({ text: msg, title: "Start 'Em group" }); } catch (e) { if (e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(msg); toast("Invite link copied."); } catch { toast(`Code: ${code}`); }
    };
    s.el.querySelectorAll("[data-invite]").forEach((b) => b.addEventListener("click", () => invite(b.dataset.invite, b.dataset.name)));
    s.el.querySelectorAll("[data-leave]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await askConfirm("Leave this group?", "You can rejoin any time with the code.", "Leave group"))) return;
      try { await api("leaveGroup", { group: b.dataset.leave }); s.close(); toast("You left the group."); home(); } catch (e) { toast(e.message); }
    }));
    $("[data-join]", s.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const gr = await api("joinGroup", { code: $("#jc", s.el).value }); s.close(); lbGroup = gr.id; toast(gr.already ? `You're already in ${gr.name}.` : `You joined ${gr.name}.`); home(); } catch (err) { toast(err.message); }
    });
    $("[data-make]", s.el).addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const gr = await api("createGroup", { name: $("#gn", s.el).value }); s.close(); lbGroup = gr.id; await home(); toast(`${gr.name} is live. Code ${gr.code}.`); setTimeout(() => invite(gr.code, gr.name), 400); } catch (err) { toast(err.message); }
    });
  }

  // ================= PROFILE =================
  async function profileView() {
    let p;
    try { p = await api("profile"); } catch (e) { return toast(e.message); }
    const st = p.stats || { games: 0, greens: 0, best_wins: 0 };

    const days = Array.from({ length: 21 }, (_, i) => { const d = new Date(Date.parse(me.today) - (20 - i) * 864e5).toISOString().slice(0, 10); return [d, p.daily.find((x) => x.play_date === d)]; });
    const tile = (label, value, sub = "") => `<div class="tile"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    app.innerHTML = `
    ${topbar(`<span class="modetag">Profile</span>`)}
    <div class="wrap profile">
      <section class="panel">
        <div class="ph"><h2>${esc(p.username)}</h2><span class="aside">${p.streak.current ? `${p.streak.current}-day streak` : "Play today's Daily to start a streak"}</span></div>
        <div class="tiles">
          ${tile("Daily streak", p.streak.current, p.streak.playedToday ? (p.streak.freezeLeft ? "Played today · 🧊 freeze ready" : "Played today") : p.streak.current ? (p.streak.freezeLeft ? "🧊 Freeze ready if you miss today" : "Play today to keep it") : "")}
          ${tile("Best streak", p.streak.best)}
          ${tile("Ranked", p.ranked && !p.ranked.placing ? `${p.ranked.sr}` : "–", p.ranked ? (p.ranked.placing ? `Placement ${p.ranked.games}/${p.ranked.placementTotal}` : `${tierBadge(p.ranked.tier, "sm")} Peak ${esc(p.ranked.peakTier.label)}`) : "5 placement games")}
          ${tile("Best score", p.best ? Number(p.best.total).toFixed(1) : "–", p.best ? `${p.best.record} season` : "Daily or Ranked")}
          ${tile("Games played", st.games)}
          ${tile("Green picks", st.greens, st.games ? `${Math.round((st.greens / (st.games * 7)) * 100)}% of picks` : "")}
        </div>
      </section>

      <div class="pgrid">
        <section class="panel">
          <div class="ph"><h2>Daily history</h2><span class="aside">Last 3 weeks</span></div>
          <div class="cal">${days.map(([d, x]) => `<div class="day ${x ? (parseInt(x.record) >= 10 ? "hot" : parseInt(x.record) >= 6 ? "good" : "played") : ""}" title="${d}${x ? `: ${x.total.toFixed(1)} PPR` : ""}"><span>${new Date(d + "T12:00:00").getDate()}</span>${x ? `<b>${Math.round(x.total)}</b>` : ""}</div>`).join("")}</div>
          <div class="callouts" style="padding:0 18px 18px;margin:0">
            ${st.best_pick ? `<div class="callout good"><span>Best pick ever</span><b>${esc(st.best_pick.name)}</b>, ${Number(st.best_pick.pts).toFixed(1)} pts (${st.best_pick.season} ${esc(st.best_pick.team)})</div>` : `<div class="callout"><span>Best pick ever</span>Play a game to set one.</div>`}
            ${st.worst_miss ? `<div class="callout bad"><span>Worst miss ever</span><b>${esc(st.worst_miss.name)}</b> over ${esc(st.worst_miss.instead)}, cost ${Number(st.worst_miss.lost).toFixed(1)}</div>` : `<div class="callout"><span>Worst miss ever</span>None yet.</div>`}
          </div>
        </section>
        <section class="turf lineup">
          <div class="ph"><h2>Best lineup ever</h2><span class="aside">${p.best ? `${p.best.record} · ${p.best.mode}` : "Daily or Ranked"}</span></div>
          ${p.best ? [...p.best.lineup].sort((x, y) => ORDER.indexOf(x.slot) - ORDER.indexOf(y.slot)).map((l) => `<div class="slot f" style="--c:${tc(l.team)[0]}"><span class="s ${l.slot === "FLEX" ? "sm" : ""}">${SLOT_LABEL[l.slot]}</span><span class="p"><div class="nm">${esc(l.name)}</div><div class="meta">${l.season} ${esc(l.team)}</div></span><span class="pt">${Number(l.pts).toFixed(1)}</span></div>`).join("") + `<div class="turf-total">${Number(p.best.total).toFixed(1)} PPR</div>` : `<div class="slot"><span class="s">–</span><span class="p"><div class="meta">Finish a Daily or Ranked game to fill this in.</div></span><span></span></div>`}
        </section>
      </div>

      <section class="panel" style="margin-top:20px">
        <div class="ph"><h2>Daily reminder</h2><span class="aside">Keep your streak alive</span></div>
        <div class="gbody">${reminderBar(true)}</div>
      </section>

      <section class="panel" style="margin-top:20px">
        <div class="ph"><h2>Your groups</h2><span class="aside">${p.groups.length} of 10</span></div>
        <div class="gbody">
          ${p.groups.length ? `<div class="glist">${p.groups.map((gr) => `<div class="gitem"><div><b>${esc(gr.name)}</b><span>${gr.members} ${gr.members === 1 ? "member" : "members"} · code <code>${gr.code}</code></span></div></div>`).join("")}</div>` : `<p class="hint" style="margin-bottom:12px">No groups yet. Make one for your league or group chat.</p>`}
          <button class="btn navy" data-groups>${p.groups.length ? "Manage groups" : "Make or join a group"}</button>
        </div>
      </section>

      <div class="res-actions">
        <button class="btn ghost" data-back>Back to home</button>
        <button class="btn ghost" data-out>Log out</button>
      </div>
    </div>`;
    wireTopbar(false);
    $("[data-groups]").addEventListener("click", () => groupSheet());
    $("[data-back]").addEventListener("click", home);
    wireReminder();
    $("[data-out]").addEventListener("click", async () => { await sb.auth.signOut(); });
  }

  async function pendingJoin() {
    const code = localStorage.getItem("se_join");
    if (!code || !me?.username) return;
    localStorage.removeItem("se_join");
    try { const gr = await api("joinGroup", { code }); lbGroup = gr.id; toast(`You joined ${gr.name}.`); home(); } catch (e) { toast(e.message); }
  }

  // links: ?c=<game> opens a challenge, ?join=<code> joins a group
  async function handleLinks() {
    const q = new URLSearchParams(location.search);
    const h = location.hash.match(/^#(c|join)-([A-Za-z0-9-]+)$/);
    const c = q.get("c") || (h && h[1] === "c" ? h[2] : null), join = q.get("join") || (h && h[1] === "join" ? h[2] : null);
    if (!c && !join) return;
    try { history.replaceState(null, "", location.pathname); } catch {}
    localStorage.setItem("se_seen_how", "1");
    if (c) return challengeIntro(c);
    if (join) {
      if (me?.signedIn && me.username) {
        try { const gr = await api("joinGroup", { code: join }); lbGroup = gr.id; toast(gr.already ? `You're already in ${gr.name}.` : `You joined ${gr.name}.`); home(); } catch (e) { toast(e.message); }
      } else { localStorage.setItem("se_join", join); loginSheet("Log in to join your friend's group."); }
    }
  }

  // ================= INSTALL + REMINDERS =================
  let installEvt = null;
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const canInstall = () => !standalone() && (installEvt || isIOS());
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (!game) home(); });
  try { if ("serviceWorker" in navigator && location.protocol === "https:" && !CFG.hashLinks) navigator.serviceWorker.register("sw.js"); } catch {}

  async function installApp() {
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; if (r?.outcome === "accepted") toast("Start 'Em is on your home screen."); return home(); }
    sheet(`<h2 class="sheet-h">Get the app</h2>
      <p class="sheet-lede">Add Start 'Em to your home screen. It opens full screen like an app, and you can turn on a daily reminder.</p>
      <ol class="steps">
        <li><b>Tap the Share button</b> at the bottom of Safari (the square with the arrow).</li>
        <li><b>Scroll down and tap "Add to Home Screen".</b></li>
        <li><b>Open Start 'Em from your home screen</b>, then turn on the daily reminder from your profile.</li>
      </ol>`);
  }

  const pushOn = () => localStorage.getItem("se_push") === "1";
  function reminderBar(inProfile) {
    const on = pushOn();
    return `<div class="remind ${inProfile ? "in" : ""}">
      <div><b>${on ? "Reminders are on." : "Never miss a Daily."}</b> <span>${on ? "We'll ping you once a day when the new Daily drops." : "Get one notification a day when the new Daily drops, plus a heads-up when your streak is on the line."}</span></div>
      <button class="btn ${on ? "ghost" : "yel"}" data-remind>${on ? "Turn off" : "Remind me"}</button>
    </div>`;
  }
  const b64ToBytes = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  function wireReminder() {
    app.querySelectorAll("[data-remind]").forEach((b) => b.addEventListener("click", async () => {
      if (pushOn()) {
        try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await api("deletePush", { endpoint: sub.endpoint }); await sub.unsubscribe(); } } catch {}
        localStorage.removeItem("se_push"); toast("Reminders are off."); return refreshView();
      }
      await enableReminders();
    }));
  }
  async function enableReminders() {
    if (!CFG.vapidPublicKey) { toast("Reminders turn on once the site is live."); return false; }
    if (isIOS() && !standalone()) { installApp(); return false; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { toast("This browser can't do notifications. Try Chrome, or add Start 'Em to your home screen."); return false; }
    try {
      if ((await Notification.requestPermission()) !== "granted") { toast("Notifications are blocked. You can allow them in your browser settings."); return false; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CFG.vapidPublicKey) }));
      await api("savePush", { sub: sub.toJSON() });
      localStorage.setItem("se_push", "1"); toast("You're set. One ping a day when the Daily drops."); refreshView();
      return true;
    } catch (e) { toast("Couldn't turn on reminders. Try again."); return false; }
  }

  // Ask once after a finished game (the moment people are most into it). If they say "Not now",
  // ask again at most once, 3+ days later. Never ask if blocked, already on, or another pop-up is open.
  function maybeAskReminders() {
    if (!CFG.vapidPublicKey || pushOn() || document.querySelector(".sheet-wrap, .reveal-wrap") || !document.querySelector("#share")) return;
    if (typeof Notification !== "undefined" && Notification.permission === "denied") return;
    const iosNeedsInstall = isIOS() && !standalone();
    if (!iosNeedsInstall && (!("serviceWorker" in navigator) || !("PushManager" in window))) return;
    let st = {}; try { st = JSON.parse(localStorage.getItem("se_push_ask") || "{}"); } catch {}
    if ((st.n || 0) >= 2 || (st.t && Date.now() - st.t < 3 * 864e5)) return;
    const s = sheet(`
      <h2 class="sheet-h">Never miss a Daily</h2>
      <p class="sheet-lede">${iosNeedsInstall
        ? "Add Start 'Em to your home screen and we'll send one reminder a day when the new Daily drops. No spam."
        : "Get one notification a day when the new Daily drops, plus a heads-up when your streak is on the line. No spam."}</p>
      <button class="btn yel big" data-yes style="width:100%">${iosNeedsInstall ? "Add to home screen" : "Turn on reminders"}</button>
      <button class="btn ghost" data-no style="width:100%;margin-top:10px">Not now</button>`);
    const mark = () => { try { localStorage.setItem("se_push_ask", JSON.stringify({ n: (st.n || 0) + 1, t: Date.now() })); } catch {} };
    mark();
    $("[data-yes]", s.el).addEventListener("click", async () => { s.close(); await enableReminders(); });
    $("[data-no]", s.el).addEventListener("click", () => s.close());
  }
  const refreshView = () => app.querySelectorAll("[data-remind]").forEach((b) => { const box = b.closest(".remind"); const tmp = document.createElement("div"); tmp.innerHTML = reminderBar(box.classList.contains("in")); box.replaceWith(tmp.firstElementChild); wireReminder(); });

  window.addEventListener("hashchange", () => handleLinks());
  // ---------- boot ----------
  // re-render only when the logged-in account actually changes (Supabase also fires SIGNED_IN on tab refocus)
  let uid;
  sb.auth.getSession().then(({ data }) => {
    session = data.session; uid = session?.user?.id || null;
    home().then(() => { handleLinks(); pendingJoin(); });
    sb.auth.onAuthStateChange((_event, s) => {
      session = s;
      const next = s?.user?.id || null;
      if (next !== uid) { uid = next; document.querySelector(".sheet-wrap")?.remove(); home().then(pendingJoin); }
    });
  });
})();
