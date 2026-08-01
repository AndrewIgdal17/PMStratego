import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashSync } from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createToken } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

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

  if (!USERNAME_RE.test(username)) {
    return jsonResponse({ error: "INVALID_USERNAME" }, 400);
  }

  if (password.length < 8) {
    return jsonResponse({ error: "PASSWORD_TOO_SHORT" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const usernameLower = username.toLowerCase();

  const { data: existing } = await supabase
    .from("players")
    .select("id")
    .eq("username_lower", usernameLower)
    .maybeSingle();

  if (existing) {
    return jsonResponse({ error: "USERNAME_TAKEN" }, 409);
  }

  const passwordHash = hashSync(password);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert({
      username,
      username_lower: usernameLower,
      password_hash: passwordHash,
    })
    .select("id, username")
    .single();

  if (playerError || !player) {
    return jsonResponse({ error: "SIGNUP_FAILED", detail: playerError?.message }, 500);
  }

  const { error: statsError } = await supabase
    .from("player_stats")
    .insert({ player_id: player.id });

  if (statsError) {
    return jsonResponse({ error: "SIGNUP_FAILED", detail: statsError.message }, 500);
  }

  const token = await createToken(player.id, player.username);

  return jsonResponse({ token, username: player.username });
});
