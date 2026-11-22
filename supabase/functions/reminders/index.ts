// @ts-nocheck
// Daily reminder: sends a web push to everyone who opted in. Called once a day by pg_cron (see README).
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { todayET, dailyNumber, themeFor } from "../game/game.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:hello@example.com", Deno.env.get("VAPID_PUBLIC_KEY"), Deno.env.get("VAPID_PRIVATE_KEY"));

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const today = todayET(), n = dailyNumber(today), theme = themeFor(today);
  const siteUrl = Deno.env.get("SITE_URL") || "./";
  const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint,user_id,sub,last_sent");
  if (error) return new Response(error.message, { status: 500 });

  // who's on a streak, so the message can say so
  const ids = [...new Set(subs.map((s) => s.user_id).filter(Boolean))];
  const streaks = {};
  if (ids.length) {
    const since = new Date(Date.parse(today) - 400 * 864e5).toISOString().slice(0, 10);
    const { data } = await admin.from("daily_results").select("user_id,play_date").in("user_id", ids).gte("play_date", since);
    const byUser = {};
    for (const r of data || []) (byUser[r.user_id] ||= new Set()).add(r.play_date);
    for (const [u, set] of Object.entries(byUser)) {
      let c = 0, d = new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);
      while (set.has(d)) { c++; d = new Date(Date.parse(d) - 864e5).toISOString().slice(0, 10); }
      streaks[u] = c;
    }
  }

  let sent = 0, removed = 0;
  for (const s of subs) {
    if (s.last_sent === today) continue;
    const streak = s.user_id ? streaks[s.user_id] || 0 : 0;
    const title = theme ? `Daily #${n}: ${theme.name}` : `Daily #${n} is live`;
    const body = streak >= 2 ? `You're on a ${streak}-day streak. Don't let it end today.` : theme ? `${theme.desc} Who are you starting?` : "Seven new teams are waiting. Who are you starting?";
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title, body, url: siteUrl }), { TTL: 60 * 60 * 12 });
      await admin.from("push_subscriptions").update({ last_sent: today }).eq("endpoint", s.endpoint);
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint); removed++; }
    }
  }
  return new Response(JSON.stringify({ sent, removed }), { headers: { "content-type": "application/json" } });
});
