// Start 'Em share-link previews (Cloudflare Worker, free plan).
// Put this in front of the GitHub Pages site on your own domain:
//   /c/<gameId>  -> preview page with that player's card + score, then redirects into the challenge
//   anything else -> passed through to the site
// Env vars (Worker settings): ORIGIN (your github.io site URL, ending in /), SUPABASE_URL, SUPABASE_ANON_KEY
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/c\/([0-9a-f-]{36})\/?$/i);
    if (!m) return passThrough(req, url, env);

    const id = m[1];
    const site = `${url.origin}/`;
    const target = `${site}?c=${id}`;
    let info = null;
    try {
      const r = await fetch(`${env.SUPABASE_URL}/functions/v1/game`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: "challengeInfo", id }),
      });
      if (r.ok) info = await r.json();
    } catch { /* fall back to the generic preview */ }

    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const card = `${env.SUPABASE_URL}/storage/v1/object/public/cards/${id}.png`;
    const hasCard = info && (await fetch(card, { method: "HEAD" })).ok;
    const title = info ? `${info.username} put up ${info.total.toFixed(1)} PPR on Start 'Em` : "Start 'Em — who are you starting?";
    const desc = info ? `${info.record.wins}-${info.record.losses} season${info.number ? ` on Daily #${info.number}` : ""}. Same seven teams. Can you beat it?` : "7 random NFL teams. 7 picks. Full PPR since 1999.";
    const image = hasCard ? card : `${site}og-image.png`;
    const big = hasCard ? { w: 1080, h: 1350 } : { w: 1200, h: 630 };

    return new Response(`<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Start 'Em">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url.href)}"><meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="${big.w}"><meta property="og:image:height" content="${big.h}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
</head><body><script>location.replace(${JSON.stringify(target)})</script><a href="${esc(target)}">Play the challenge</a></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
  },
};

async function passThrough(req, url, env) {
  const origin = new URL(env.ORIGIN);
  const path = url.pathname.replace(/^\//, "");
  const upstream = new URL(path + url.search, origin);
  const res = await fetch(new Request(upstream, req));
  return new Response(res.body, res);
}
