// Draws the shareable result card (1080x1350), styled like the site's "Your lineup" field panel.
window.StartEmShare = (() => {
  const C = { navy: "#0D1A2B", ink: "#0B1220", ink3: "#7B889C", steel: "#A9B7CB", yel: "#FFD93D", turf: "#17603A", turf2: "#1A6B41", board: "#07101C", dots: "#16233A", best: "#12B76A", close: "#D99B00", miss: "#E5383B" };
  const GRADE = { best: C.best, close: C.close, miss: C.miss };
  const LABEL = { QB: "QB", RB1: "RB", RB2: "RB", WR1: "WR", WR2: "WR", TE: "TE", FLEX: "FLEX" };
  const ORDER = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX"];
  const DISP = '"Saira Condensed", "Arial Narrow", sans-serif', BODY = '"Inter Tight", system-ui, sans-serif', DOTS = '"Doto", "Courier New", monospace';

  async function fonts() {
    try {
      await Promise.all([
        document.fonts.load(`900 200px ${DOTS}`), document.fonts.load(`900 60px ${DISP}`), document.fonts.load(`800 40px ${DISP}`),
        document.fonts.load(`700 30px ${BODY}`), document.fonts.load(`600 30px ${BODY}`),
      ]);
    } catch { /* fall back to system fonts */ }
  }
  const slant = (ctx, x, y, w, h, cut, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - cut, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); };
  const round = (ctx, x, y, w, h, r, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); };
  const fit = (ctx, text, max) => { if (ctx.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };


  // the Start 'Em logo: the name painted on a strip of field (same as the site header)
  function fieldLogo(ctx, x, y, size) {
    ctx.font = `italic 900 ${size}px ${DISP}`;
    const tw = ctx.measureText("START").width, ew = ctx.measureText("'EM").width, gap = size * 0.22;
    const padX = size * 0.45, h = size * 1.18, w = padX * 2 + tw + gap + ew, r = size * 0.2;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
    const band = size * 0.42; for (let i = 0; i * band < w; i++) { ctx.fillStyle = i % 2 ? C.turf2 : C.turf; ctx.fillRect(x + i * band, y, band + 1, h); }
    ctx.fillStyle = "rgba(255,255,255,.85)"; const step = size * 0.26, hw = size * 0.045, hh = size * 0.13;
    for (let hx = x + size * 0.18; hx < x + w - size * 0.12; hx += step) { ctx.fillRect(hx, y + size * 0.09, hw, hh); ctx.fillRect(hx, y + h - size * 0.09 - hh, hw, hh); }
    ctx.restore();
    const lw = Math.max(2, size * 0.05); ctx.lineWidth = lw; ctx.strokeStyle = "#fff";
    ctx.beginPath(); ctx.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, r); ctx.stroke();
    const by = y + h / 2 + size * 0.34; ctx.textAlign = "left";
    for (const [t, col, dx] of [["START", "#fff", 0], ["'EM", C.yel, tw + gap]]) {
      ctx.fillStyle = C.navy; ctx.fillText(t, x + padX + dx, by + size * 0.07);
      ctx.fillStyle = col; ctx.fillText(t, x + padX + dx, by);
    }
    return { w, h };
  }

  async function draw({ game, url, teamColors }) {
    await fonts();
    const r = game.result, W = 1080, H = 1350;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");

    // ---- field ----
    const FT = 150, FB = 1240, bands = 10, bh = (FB - FT) / bands;
    for (let i = 0; i < bands; i++) { ctx.fillStyle = i % 2 ? C.turf2 : C.turf; ctx.fillRect(0, FT + i * bh, W, bh); }
    ctx.fillStyle = "rgba(255,255,255,.5)";
    for (let i = 1; i < bands; i++) ctx.fillRect(0, FT + i * bh - 2, W, 3);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    for (let y = FT + 8; y < FB; y += 22) { ctx.fillRect(14, y, 16, 3); ctx.fillRect(W - 30, y, 16, 3); }
    const shade = ctx.createLinearGradient(0, FT, 0, FB); shade.addColorStop(0, "rgba(0,0,0,.12)"); shade.addColorStop(.5, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,.25)");
    ctx.fillStyle = shade; ctx.fillRect(0, FT, W, FB - FT);

    // ---- header ----
    ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, FT);
    slant(ctx, 0, FT - 8, W * 0.42, 8, 8, C.yel);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    fieldLogo(ctx, 60, 30, 68);
    ctx.textAlign = "right"; ctx.fillStyle = C.steel; ctx.font = `800 40px ${DISP}`;
    ctx.fillText(game.mode === "daily" ? `DAILY #${game.number}` : game.mode === "archive" ? `PAST DAILY #${game.number}` : game.mode === "ranked" ? "RANKED" : game.mode === "challenge" ? "CHALLENGE" : "CASUAL", W - 60, 98);

    // ---- scoreboard row ----
    const sy = 192, sh = 214;
    round(ctx, 60, sy, 600, sh, 12, C.board);
    ctx.save(); ctx.beginPath(); ctx.roundRect(60, sy, 600, sh, 12); ctx.clip();
    ctx.fillStyle = C.dots; for (let y = sy + 6; y < sy + sh; y += 11) for (let x = 66; x < 660; x += 11) { ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 7); ctx.fill(); }
    ctx.restore();
    ctx.textAlign = "left"; ctx.fillStyle = C.steel; ctx.font = `700 30px ${DISP}`; ctx.fillText("TOTAL PPR", 92, sy + 50);
    ctx.font = `900 132px ${DOTS}`; ctx.fillStyle = C.yel; ctx.shadowColor = "rgba(255,190,0,.65)"; ctx.shadowBlur = 26;
    ctx.fillText(fit(ctx, r.total.toFixed(1), 540), 84, sy + 178); ctx.shadowBlur = 0;

    // badge, accuracy, pick squares
    const rx = 690;
    ctx.font = `italic 900 46px ${DISP}`;
    const badge = `${r.record.wins}-${r.record.losses} SEASON`, bw = ctx.measureText(badge).width + 52;
    slant(ctx, rx, sy + 8, bw, 66, 14, r.record.wins === 14 ? C.best : C.yel);
    ctx.fillStyle = r.record.wins === 14 ? "#fff" : C.ink; ctx.fillText(badge, rx + 18, sy + 58);
    ctx.fillStyle = "#fff"; ctx.font = `700 34px ${BODY}`; ctx.fillText(`${r.pct}% pick accuracy`, rx, sy + 128);
    const picks = [...game.picks].sort((a, b) => ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot));
    picks.forEach((p, i) => round(ctx, rx + i * 46, sy + 158, 36, 36, 7, GRADE[p.grade]));

    // ---- lineup cards ----
    let y = 440;
    const rh = 98, gap = 12;
    picks.forEach((p) => {
      const col = (teamColors[p.team] || ["#556"])[0];
      ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
      round(ctx, 60, y, W - 120, rh, 6, "#fff");
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.fillStyle = col; ctx.fillRect(60, y, 12, rh);
      ctx.textAlign = "center"; ctx.fillStyle = C.ink; ctx.font = `italic 900 ${p.slot === "FLEX" ? 36 : 44}px ${DISP}`;
      ctx.fillText(LABEL[p.slot], 140, y + 64);
      ctx.fillStyle = GRADE[p.grade]; ctx.beginPath(); ctx.arc(222, y + 38, 9, 0, 7); ctx.fill();
      ctx.textAlign = "left"; ctx.fillStyle = C.ink; ctx.font = `700 36px ${BODY}`;
      ctx.fillText(fit(ctx, p.player.name, 560), 242, y + 50);
      ctx.fillStyle = C.ink3; ctx.font = `600 25px ${BODY}`;
      ctx.fillText(fit(ctx, `${p.season} ${p.teamName}`, 560), 242, y + 82);
      ctx.textAlign = "right"; ctx.fillStyle = C.ink; ctx.font = `italic 900 52px ${DISP}`;
      ctx.fillText(p.player.pts.toFixed(1), W - 92, y + 66);
      y += rh + gap;
    });

    // ---- footer ----
    ctx.fillStyle = C.navy; ctx.fillRect(0, FB, W, H - FB);
    slant(ctx, 0, FB, W * 0.42, 8, 8, C.yel);
    ctx.textAlign = "left"; ctx.fillStyle = C.yel; ctx.font = `italic 900 46px ${DISP}`; ctx.fillText("CAN YOU BEAT IT?", 60, FB + 72);
    ctx.textAlign = "right"; ctx.fillStyle = "#fff"; ctx.font = `700 30px ${BODY}`;
    ctx.fillText(fit(ctx, url.replace(/^https?:\/\//, "").replace(/\/$/, ""), 480), W - 60, FB + 70);

    return new Promise((res) => cv.toBlob((b) => res({ blob: b, dataUrl: cv.toDataURL("image/png") }), "image/png"));
  }


  // ---- 9-second vertical video (1080x1920) for TikTok / Reels / Stories ----
  // Drawn on a canvas and recorded in real time with MediaRecorder. No audio.
  const videoType = () => {
    if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) return null;
    for (const t of ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
    }
    return null;
  };
  const canVideo = () => !!videoType();

  async function video({ game, url, teamColors, onProgress }) {
    const type = videoType();
    if (!type) throw new Error("This browser can't make videos. Try Chrome or Safari.");
    await fonts();
    const r = game.result, W = 1080, H = 1920, FPS = 30, DUR = 9.2;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const picks = game.picks; // in the order they were picked: that's the story
    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
    const T0 = 0.9, STEP = 0.72, END = T0 + picks.length * STEP; // picks land 0.9s .. ~5.9s
    const modeLine = game.mode === "daily" ? `DAILY #${game.number}${game.theme ? ` · ${game.theme.name.toUpperCase()}` : ""}` : game.mode === "archive" ? `DAILY #${game.number}` : game.mode === "ranked" ? "RANKED" : game.mode === "challenge" ? "CHALLENGE" : "CASUAL";
    const site = url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/c\/.*$/, "").replace(/\/(index\.html)?$/, "");

    function frame(t) {
      // background: navy with the turf field in the middle
      ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H);
      const FT = 640, FB = 1690, bands = 12, bh = (FB - FT) / bands;
      for (let i = 0; i < bands; i++) { ctx.fillStyle = i % 2 ? C.turf2 : C.turf; ctx.fillRect(0, FT + i * bh, W, bh); }
      ctx.fillStyle = "rgba(255,255,255,.45)"; for (let i = 1; i < bands; i++) ctx.fillRect(0, FT + i * bh - 2, W, 3);

      // logo + mode
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      fieldLogo(ctx, 70, 66, 100);
      ctx.fillStyle = C.steel; ctx.font = `800 44px ${DISP}`; ctx.fillText(fit(ctx, modeLine, W - 140), 70, 248);

      // scoreboard: running total
      const landed = picks.filter((_, i) => t >= T0 + i * STEP + 0.45);
      let total = landed.reduce((a, p) => a + p.player.pts, 0);
      const cur = picks.findIndex((_, i) => t >= T0 + i * STEP && t < T0 + i * STEP + 0.45);
      if (cur >= 0) total += picks[cur].player.pts * ease((t - T0 - cur * STEP) / 0.45);
      const sy = 300, sh = 290;
      round(ctx, 70, sy, W - 140, sh, 16, C.board);
      ctx.save(); ctx.beginPath(); ctx.roundRect(70, sy, W - 140, sh, 16); ctx.clip();
      ctx.fillStyle = C.dots; for (let y = sy + 8; y < sy + sh; y += 14) for (let x = 78; x < W - 70; x += 14) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = C.steel; ctx.font = `700 36px ${DISP}`; ctx.fillText("TOTAL PPR", 110, sy + 62);
      const done = t >= END + 0.2, pulse = done ? 1 + 0.04 * Math.sin(Math.min(1, (t - END - 0.2) / 0.5) * Math.PI) : 1;
      ctx.save(); ctx.translate(100, sy + 252); ctx.scale(pulse, pulse);
      ctx.font = `900 172px ${DOTS}`; ctx.fillStyle = C.yel; ctx.shadowColor = "rgba(255,190,0,.7)"; ctx.shadowBlur = 34;
      ctx.fillText((done ? r.total : total).toFixed(1), 0, 0); ctx.restore(); ctx.shadowBlur = 0;

      // pick rows, sliding in one at a time
      const rh = 118, gap = 22, top = FT + 34;
      picks.forEach((p, i) => {
        const k = ease((t - T0 - i * STEP) / 0.3);
        const y = top + i * (rh + gap);
        if (k <= 0) { // empty spot waiting
          ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(70, y, W - 140, rh);
          ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = `italic 900 46px ${DISP}`; ctx.fillText(LABEL[p.slot], 160, y + 76);
          return;
        }
        const x = 70 + (1 - k) * (W + 40);
        const col = (teamColors[p.team] || ["#556"])[0];
        ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
        round(ctx, x, y, W - 140, rh, 8, "#fff");
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = col; ctx.fillRect(x, y, 14, rh);
        ctx.textAlign = "center"; ctx.fillStyle = C.ink; ctx.font = `italic 900 ${p.slot === "FLEX" ? 40 : 50}px ${DISP}`; ctx.fillText(LABEL[p.slot], x + 92, y + 76);
        ctx.textAlign = "left"; ctx.font = `700 42px ${BODY}`; ctx.fillText(fit(ctx, p.player.name, 560), x + 178, y + 56);
        ctx.fillStyle = C.ink3; ctx.font = `600 29px ${BODY}`; ctx.fillText(fit(ctx, `${p.season} ${p.teamName}`, 560), x + 178, y + 96);
        const pk = ease((t - T0 - i * STEP - 0.1) / 0.4);
        ctx.textAlign = "right"; ctx.fillStyle = C.ink; ctx.font = `italic 900 64px ${DISP}`;
        ctx.fillText((p.player.pts * pk).toFixed(1), x + W - 140 - 72, y + 80);
        if (pk >= 1) { ctx.fillStyle = GRADE[p.grade]; ctx.beginPath(); ctx.arc(x + W - 140 - 36, y + rh / 2, 14, 0, 7); ctx.fill(); }
      });

      // footer
      ctx.fillStyle = C.navy; ctx.fillRect(0, FB, W, H - FB);
      slant(ctx, 0, FB, W * 0.42, 10, 10, C.yel);
      ctx.textAlign = "left"; ctx.fillStyle = C.yel; ctx.font = `italic 900 64px ${DISP}`; ctx.fillText("CAN YOU BEAT IT?", 70, FB + 110);
      ctx.fillStyle = "#fff"; ctx.font = `700 44px ${BODY}`; ctx.fillText(site, 70, FB + 180);

      // intro title over everything for the first second
      if (t < T0) {
        const a = t < 0.65 ? 1 : 1 - (t - 0.65) / (T0 - 0.65);
        ctx.fillStyle = `rgba(13,26,43,${0.82 * a})`; ctx.fillRect(0, FT, W, FB - FT);
        ctx.globalAlpha = a; ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = `italic 900 120px ${DISP}`;
        ctx.fillText("WHO ARE YOU", W / 2, FT + 440); ctx.fillStyle = C.yel; ctx.fillText("STARTING?", W / 2, FT + 570); ctx.globalAlpha = 1;
      }

      // finale: record badge + squares pop in over the scoreboard's right side
      if (t >= END + 0.15) {
        const k = ease((t - END - 0.15) / 0.35);
        ctx.save(); ctx.globalAlpha = k;
        ctx.font = `italic 900 50px ${DISP}`;
        const badge = `${r.record.wins}-${r.record.losses} SEASON`, bw = ctx.measureText(badge).width + 56;
        slant(ctx, W - 70 - bw - 20, sy + 22, bw, 70, 16, r.record.wins === 14 ? C.best : C.yel);
        ctx.textAlign = "left"; ctx.fillStyle = r.record.wins === 14 ? "#fff" : C.ink; ctx.fillText(badge, W - 70 - bw - 20 + 20, sy + 73);
        // pick squares up in the header, right-aligned on the mode line
        const ordered = [...picks].sort((a, b) => ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot));
        ordered.forEach((p, i) => round(ctx, W - 70 - (7 - i) * 54 + 12, 208, 42, 42, 8, GRADE[p.grade]));
        ctx.restore();
      }
    }

    const stream = cv.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    frame(0); rec.start(250);
    const start = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const t = (performance.now() - start) / 1000;
        frame(Math.min(t, DUR));
        onProgress?.(Math.min(1, t / DUR));
        if (t >= DUR) return res();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    rec.stop(); stream.getTracks().forEach((tr) => tr.stop());
    await stopped;
    const mime = type.split(";")[0], ext = mime === "video/mp4" ? "mp4" : "webm";
    return { blob: new Blob(chunks, { type: mime }), mime, ext };
  }

  function text({ game, url }) {
    const r = game.result;
    const grid = [...game.picks].sort((a, b) => ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot)).map((p) => ({ best: "🟩", close: "🟨", miss: "🟥" })[p.grade]).join("");
    const title = game.mode === "daily" ? `Start 'Em Daily #${game.number}${game.theme ? ` (${game.theme.name})` : ""}` : game.mode === "archive" ? `Start 'Em Daily #${game.number} (played late)` : `Start 'Em ${game.mode === "ranked" ? "Ranked" : game.mode === "challenge" ? "Challenge" : "Casual"}`;
    return `${title} 🏈\n${r.total.toFixed(1)} PPR · ${r.record.wins}-${r.record.losses} season\n${grid}\nCan you beat it? ${url}`;
  }

  return { draw, text, video, canVideo };
})();
