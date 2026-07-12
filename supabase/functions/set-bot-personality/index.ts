import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALID_PERSONALITIES = ["aggressive", "neutral", "defensive"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, personality } = await req.json();
  if (!token || !personality) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
  }

  if (!VALID_PERSONALITIES.includes(personality)) {
    return new Response(JSON.stringify({ error: "INVALID_PERSONALITY" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401, headers: corsHeaders });
  }

  if (playerRow.player_slot !== 1) {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 403, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, is_bot_game")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || !game.is_bot_game || game.status !== "setup") {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 409, headers: corsHeaders });
  }

  const { error: updateError } = await supabase
    .from("games")
    .update({ bot_personality: personality, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "UPDATE_FAILED", detail: updateError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, personality }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
