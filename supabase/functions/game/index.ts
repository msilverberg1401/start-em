// @ts-nocheck
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle } from "./api.ts";
import { makeStore } from "./store.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const db = makeStore(admin);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // let browsers reuse the permission check instead of asking before every request (an extra round trip each time)
  "Access-Control-Max-Age": "86400",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  // Signed-in players send their session token; logged-out players send only the public key.
  let auth = null;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token) {
    // getClaims checks the token's signature locally (cached signing keys), skipping a round trip to the auth server
    const { data } = await admin.auth.getClaims(token).catch(() => ({ data: null }));
    const c = data?.claims;
    if (c?.sub && c.role === "authenticated") auth = { id: c.sub, email: c.email };
  }

  const res = await handle({ body, auth, db });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...cors, "content-type": "application/json" } });
});
