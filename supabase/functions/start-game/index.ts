// supabase/functions/start-game/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COUNTDOWN_SECONDS = 10;

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
    .select("game_id")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, both_submitted_at")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "GAME_NOT_FOUND" }), { status: 404, headers: corsHeaders });
  }

  if (game.status === "active") {
    return new Response(JSON.stringify({ ok: true, alreadyActive: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), { status: 409, headers: corsHeaders });
  }

  if (!game.both_submitted_at) {
    return new Response(JSON.stringify({ error: "NOT_BOTH_SUBMITTED" }), { status: 400, headers: corsHeaders });
  }

  const elapsed = (Date.now() - new Date(game.both_submitted_at).getTime()) / 1000;
  if (elapsed < COUNTDOWN_SECONDS) {
    return new Response(JSON.stringify({ error: "COUNTDOWN_NOT_FINISHED", remainingSeconds: Math.ceil(COUNTDOWN_SECONDS - elapsed) }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { data: allPlayers, error: allPlayersError } = await supabase
    .from("game_players")
    .select("setup_submitted")
    .eq("game_id", playerRow.game_id);

  if (allPlayersError) {
    return new Response(JSON.stringify({ error: "READINESS_CHECK_FAILED" }), { status: 500, headers: corsHeaders });
  }

  const bothReady = allPlayers?.length === 2 && allPlayers.every((p) => p.setup_submitted);
  if (!bothReady) {
    return new Response(JSON.stringify({ error: "NOT_BOTH_SUBMITTED" }), { status: 400, headers: corsHeaders });
  }

  const firstTurnSlot = Math.random() < 0.5 ? 1 : 2;
  const { error: activateError } = await supabase
    .from("games")
    .update({ status: "active", current_turn_slot: firstTurnSlot, turn_number: 1, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (activateError) {
    return new Response(JSON.stringify({ error: "GAME_ACTIVATION_FAILED", detail: activateError.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
