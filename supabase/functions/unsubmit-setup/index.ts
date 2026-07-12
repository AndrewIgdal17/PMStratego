// supabase/functions/unsubmit-setup/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot, setup_submitted")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401, headers: corsHeaders });
  }

  if (!playerRow.setup_submitted) {
    return new Response(JSON.stringify({ error: "SETUP_NOT_SUBMITTED" }), { status: 409, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), { status: 409, headers: corsHeaders });
  }

  const { error: deletePiecesError } = await supabase
    .from("pieces")
    .delete()
    .eq("game_id", playerRow.game_id)
    .eq("player_slot", playerRow.player_slot);

  if (deletePiecesError) {
    return new Response(JSON.stringify({ error: "DELETE_PIECES_FAILED", detail: deletePiecesError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  const { error: resetFlagError } = await supabase
    .from("game_players")
    .update({ setup_submitted: false })
    .eq("game_id", playerRow.game_id)
    .eq("player_slot", playerRow.player_slot);

  if (resetFlagError) {
    return new Response(JSON.stringify({ error: "RESET_FLAG_FAILED", detail: resetFlagError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  const { error: clearTimestampError } = await supabase
    .from("games")
    .update({ both_submitted_at: null, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (clearTimestampError) {
    return new Response(JSON.stringify({ error: "CLEAR_TIMESTAMP_FAILED", detail: clearTimestampError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
