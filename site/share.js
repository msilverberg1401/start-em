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
    ctx.font = `italic 900 76px ${DISP}`; ctx.fillStyle = "#fff"; ctx.fillText("START", 60, 102);
    const sw = ctx.measureText("START").width;
    slant(ctx, 60 + sw + 14, 36, ctx.measureText("'EM").width + 44, 80, 14, C.yel);
    ctx.fillStyle = C.ink; ctx.fillText("'EM", 60 + sw + 26, 102);
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

  function text({ game, url }) {
    const r = game.result;
    const grid = [...game.picks].sort((a, b) => ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot)).map((p) => ({ best: "🟩", close: "🟨", miss: "🟥" })[p.grade]).join("");
    const title = game.mode === "daily" ? `Start 'Em Daily #${game.number}${game.theme ? ` (${game.theme.name})` : ""}` : game.mode === "archive" ? `Start 'Em Daily #${game.number} (played late)` : `Start 'Em ${game.mode === "ranked" ? "Ranked" : game.mode === "challenge" ? "Challenge" : "Casual"}`;
    return `${title} 🏈\n${r.total.toFixed(1)} PPR · ${r.record.wins}-${r.record.losses} season\n${grid}\nCan you beat it? ${url}`;
  }

  return { draw, text };
})();
