// supabase/functions/submit-setup/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ARMY_COMPOSITION } from "../_shared/rules/pieces.js";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Placement {
  rank: string | number;
  row: number;
  col: number;
}

function territoryRowsFor(playerSlot: number): number[] {
  return playerSlot === 1 ? [6, 7, 8, 9] : [0, 1, 2, 3];
}

function validatePlacements(playerSlot: number, placements: Placement[]): string | null {
  const totalExpected = ARMY_COMPOSITION.reduce((sum, e) => sum + e.count, 0);
  if (placements.length !== totalExpected) {
    return "WRONG_PIECE_COUNT";
  }

  const countByRank = new Map<string, number>();
  const seenSquares = new Set<string>();
  const allowedRows = new Set(territoryRowsFor(playerSlot));

  for (const p of placements) {
    const key = `${p.row},${p.col}`;
    if (seenSquares.has(key)) return "DUPLICATE_SQUARE";
    seenSquares.add(key);

    if (!allowedRows.has(p.row) || p.col < 0 || p.col > 9) return "OUTSIDE_TERRITORY";

    const rankKey = String(p.rank);
    countByRank.set(rankKey, (countByRank.get(rankKey) ?? 0) + 1);
  }

  for (const entry of ARMY_COMPOSITION) {
    if (countByRank.get(String(entry.rank)) !== entry.count) {
      return "WRONG_ARMY_COMPOSITION";
    }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, placements } = await req.json();
  if (!token || !Array.isArray(placements)) {
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
  if (playerRow.setup_submitted) {
    return new Response(JSON.stringify({ error: "SETUP_ALREADY_SUBMITTED" }), { status: 409, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), { status: 409, headers: corsHeaders });
  }

  const validationError = validatePlacements(playerRow.player_slot, placements);
  if (validationError) {
    return new Response(JSON.stringify({ error: validationError }), { status: 400, headers: corsHeaders });
  }

  const rows = placements.map((p: Placement) => ({
    game_id: playerRow.game_id,
    player_slot: playerRow.player_slot,
    rank: String(p.rank),
    row_idx: p.row,
    col_idx: p.col,
  }));

  const { error: insertError } = await supabase.from("pieces").insert(rows);
  if (insertError) {
    return new Response(JSON.stringify({ error: "INSERT_FAILED", detail: insertError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const { error: submitFlagError } = await supabase
    .from("game_players")
    .update({ setup_submitted: true })
    .eq("game_id", playerRow.game_id)
    .eq("player_slot", playerRow.player_slot);

  if (submitFlagError) {
    return new Response(
      JSON.stringify({ error: "SETUP_FLAG_UPDATE_FAILED", detail: submitFlagError.message }),
      { status: 500, headers: corsHeaders },
    );
  }

  const { data: allPlayers, error: allPlayersError } = await supabase
    .from("game_players")
    .select("setup_submitted")
    .eq("game_id", playerRow.game_id);

  if (allPlayersError) {
    return new Response(
      JSON.stringify({ error: "READINESS_CHECK_FAILED", detail: allPlayersError.message }),
      { status: 500, headers: corsHeaders },
    );
  }

  const bothReady = allPlayers?.length === 2 && allPlayers.every((p) => p.setup_submitted);

  if (bothReady) {
    const firstTurnSlot = Math.random() < 0.5 ? 1 : 2;
    const { error: activateError } = await supabase
      .from("games")
      .update({ status: "active", current_turn_slot: firstTurnSlot, turn_number: 1 })
      .eq("id", playerRow.game_id);

    if (activateError) {
      return new Response(
        JSON.stringify({ error: "GAME_ACTIVATION_FAILED", detail: activateError.message }),
        { status: 500, headers: corsHeaders },
      );
    }
  }

  return new Response(JSON.stringify({ ok: true, gameStarted: bothReady }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
