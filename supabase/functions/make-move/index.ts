// supabase/functions/make-move/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyMove } from "../_shared/rules/game.js";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Square {
  row: number;
  col: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, from, to } = await req.json() as { token: string; from: Square; to: Square };
  if (!token || !from || !to) {
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

  const gameId = playerRow.game_id;
  const playerSlot = playerRow.player_slot;

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number")
    .eq("id", gameId)
    .single();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "GAME_NOT_FOUND" }), { status: 404, headers: corsHeaders });
  }

  const { data: pieceRows, error: piecesError } = await supabase
    .from("pieces")
    .select("id, player_slot, rank, row_idx, col_idx, alive")
    .eq("game_id", gameId);

  if (piecesError || !pieceRows) {
    return new Response(JSON.stringify({ error: "STATE_LOAD_FAILED" }), { status: 500, headers: corsHeaders });
  }

  const { data: moveRows, error: movesError } = await supabase
    .from("moves")
    .select("piece_id, player_slot, from_row, from_col, to_row, to_col, move_number")
    .eq("game_id", gameId)
    .order("move_number", { ascending: true });

  if (movesError) {
    return new Response(JSON.stringify({ error: "HISTORY_LOAD_FAILED" }), { status: 500, headers: corsHeaders });
  }

  const nextMoveNumber = moveRows && moveRows.length > 0
    ? moveRows[moveRows.length - 1].move_number + 1
    : 1;

  const moveHistoryByPlayer: Record<number, { pieceId: string; from: string; to: string }[]> = { 1: [], 2: [] };
  for (const m of moveRows ?? []) {
    moveHistoryByPlayer[m.player_slot].push({
      pieceId: m.piece_id,
      from: `${m.from_row},${m.from_col}`,
      to: `${m.to_row},${m.to_col}`,
    });
  }

  const state = {
    status: game.status,
    currentTurnSlot: game.current_turn_slot,
    pieces: pieceRows.map((p) => ({
      id: p.id,
      playerSlot: p.player_slot,
      rank: p.rank === "BOMB" || p.rank === "FLAG" ? p.rank : Number(p.rank),
      row: p.row_idx,
      col: p.col_idx,
      alive: p.alive,
    })),
    moveHistoryByPlayer,
  };

  const result = applyMove(state, { playerSlot, from, to });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.reason }), { status: 400, headers: corsHeaders });
  }

  const movedPiece = state.pieces.find(
    (p) => p.alive && p.row === from.row && p.col === from.col && p.playerSlot === playerSlot,
  )!;

  const moveType = result.combatResult ? "attack" : "move";

  const { error: moveInsertError } = await supabase.from("moves").insert({
    game_id: gameId,
    piece_id: movedPiece.id,
    move_number: nextMoveNumber,
    player_slot: playerSlot,
    from_row: from.row,
    from_col: from.col,
    to_row: to.row,
    to_col: to.col,
    move_type: moveType,
    outcome: result.combatResult?.outcome ?? null,
    attacker_rank: result.combatResult?.attackerRank ?? null,
    defender_rank: result.combatResult?.defenderRank ?? null,
    defender_piece_id: result.combatResult?.defenderPieceId ?? null,
  });

  if (moveInsertError) {
    return new Response(JSON.stringify({ error: "MOVE_LOG_FAILED", detail: moveInsertError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const pieceUpdates = result.newState.pieces
    .map((updated) => {
      const original = state.pieces.find((p) => p.id === updated.id)!;
      return {
        updated,
        moved: updated.row !== original.row || updated.col !== original.col,
        died: updated.alive !== original.alive,
      };
    })
    .filter((entry) => entry.moved || entry.died);

  // Apply deaths before moves so a captured piece's square is vacated
  // (alive flips to false) before any surviving piece's move can land on
  // that same square -- otherwise the pieces_alive_position_idx unique
  // index (game_id, row_idx, col_idx) WHERE alive can be violated by two
  // alive rows momentarily sharing a square across two separate UPDATE
  // statements (this is exactly what caused winning attacks to 500 in
  // production when the attacker happened to be processed first).
  pieceUpdates.sort((a, b) => Number(b.died) - Number(a.died));

  for (const { updated } of pieceUpdates) {
    const patch = {
      row_idx: updated.row,
      col_idx: updated.col,
      alive: updated.alive,
    };
    const { error: pieceUpdateError } = await supabase.from("pieces").update(patch).eq("id", updated.id);
    if (pieceUpdateError) {
      return new Response(
        JSON.stringify({ error: "PIECE_UPDATE_FAILED", detail: pieceUpdateError.message }),
        { status: 500, headers: corsHeaders },
      );
    }
  }

  const { error: gameUpdateError } = await supabase
    .from("games")
    .update({
      current_turn_slot: result.newState.currentTurnSlot,
      turn_number: nextMoveNumber + 1,
      status: result.newState.status,
      winner_slot: result.winnerSlot ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);

  if (gameUpdateError) {
    return new Response(
      JSON.stringify({ error: "GAME_STATE_UPDATE_FAILED", detail: gameUpdateError.message }),
      { status: 500, headers: corsHeaders },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, combatResult: result.combatResult, winnerSlot: result.winnerSlot }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
