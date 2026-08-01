import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { compareSync } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createToken } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "MISSING_FIELDS" }, 400);
  }

  const { username, password } = body;

  if (!username || !password) {
    return jsonResponse({ error: "MISSING_FIELDS" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: player } = await supabase
    .from("players")
    .select("id, username, password_hash")
    .eq("username_lower", username.toLowerCase())
    .maybeSingle();

  if (!player) {
    return jsonResponse({ error: "INVALID_CREDENTIALS" }, 401);
  }

  const valid = compareSync(password, player.password_hash);
  if (!valid) {
    return jsonResponse({ error: "INVALID_CREDENTIALS" }, 401);
  }

  const token = await createToken(player.id, player.username);

  return jsonResponse({ token, username: player.username });
});
