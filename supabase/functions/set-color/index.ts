import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { validateColorClaim } from "../_shared/colors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, color } = await req.json();
  if (!token || !color) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
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

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, player1_color, player2_color")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 409, headers: corsHeaders });
  }

  const slot = playerRow.player_slot === 2 ? 2 : 1;
  const result = validateColorClaim(game.status, color, slot, game.player1_color, game.player2_color);

  if (!result.ok) {
    const status = result.error === "INVALID_COLOR" ? 400 : 409;
    return new Response(JSON.stringify({ error: result.error }), { status, headers: corsHeaders });
  }

  const column = slot === 1 ? "player1_color" : "player2_color";
  const { error: updateError } = await supabase
    .from("games")
    .update({ [column]: color, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "UPDATE_FAILED", detail: updateError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, color }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
