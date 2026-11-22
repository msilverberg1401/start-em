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
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  // Signed-in players send their session token; logged-out players send only the public key.
  let auth = null;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token) {
    const { data } = await admin.auth.getUser(token);
    if (data?.user) auth = { id: data.user.id, email: data.user.email };
  }

  const res = await handle({ body, auth, db });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...cors, "content-type": "application/json" } });
});
