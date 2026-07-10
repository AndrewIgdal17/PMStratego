// supabase/functions/make-move/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyMove } from "../_shared/rules/game.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Square {
  row: number;
  col: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token, from, to } = await req.json() as { token: string; from: Square; to: Square };
  if (!token || !from || !to) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401 });
  }

  const gameId = playerRow.game_id;
  const playerSlot = playerRow.player_slot;

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number")
    .eq("id", gameId)
    .single();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "GAME_NOT_FOUND" }), { status: 404 });
  }

  const { data: pieceRows, error: piecesError } = await supabase
    .from("pieces")
    .select("id, player_slot, rank, row_idx, col_idx, alive")
    .eq("game_id", gameId);

  if (piecesError || !pieceRows) {
    return new Response(JSON.stringify({ error: "STATE_LOAD_FAILED" }), { status: 500 });
  }

  const { data: moveRows, error: movesError } = await supabase
    .from("moves")
    .select("piece_id, player_slot, from_row, from_col, to_row, to_col")
    .eq("game_id", gameId)
    .order("move_number", { ascending: true });

  if (movesError) {
    return new Response(JSON.stringify({ error: "HISTORY_LOAD_FAILED" }), { status: 500 });
  }

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
      rank: p.rank,
      row: p.row_idx,
      col: p.col_idx,
      alive: p.alive,
    })),
    moveHistoryByPlayer,
  };

  const result = applyMove(state, { playerSlot, from, to });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.reason }), { status: 400 });
  }

  const movedPiece = state.pieces.find(
    (p) => p.alive && p.row === from.row && p.col === from.col && p.playerSlot === playerSlot,
  )!;

  const moveType = result.combatResult ? "attack" : "move";

  const { error: moveInsertError } = await supabase.from("moves").insert({
    game_id: gameId,
    piece_id: movedPiece.id,
    move_number: game.turn_number,
    player_slot: playerSlot,
    from_row: from.row,
    from_col: from.col,
    to_row: to.row,
    to_col: to.col,
    move_type: moveType,
    outcome: result.combatResult?.outcome ?? null,
    attacker_rank: result.combatResult?.attackerRank ?? null,
    defender_rank: result.combatResult?.defenderRank ?? null,
  });

  if (moveInsertError) {
    return new Response(JSON.stringify({ error: "MOVE_LOG_FAILED", detail: moveInsertError.message }), { status: 500 });
  }

  // Combat always reveals BOTH participants' identity to both players, even
  // the side that wins and stays in place without moving or dying (e.g. a
  // defender that survives an attack). Track both combat participant IDs
  // separately from the moved/died check below, which only covers position
  // and life-state changes.
  const revealedPieceIds = new Set<string>();
  if (result.combatResult) {
    revealedPieceIds.add(movedPiece.id);
    const defenderId = state.pieces.find(
      (p) => p.alive && p.row === to.row && p.col === to.col && p.id !== movedPiece.id,
    )?.id;
    if (defenderId) revealedPieceIds.add(defenderId);
  }

  for (const updated of result.newState.pieces) {
    const original = state.pieces.find((p) => p.id === updated.id)!;
    const moved = updated.row !== original.row || updated.col !== original.col;
    const died = updated.alive !== original.alive;
    const needsReveal = revealedPieceIds.has(updated.id);

    if (!moved && !died && !needsReveal) continue;

    const patch: Record<string, unknown> = {};
    if (moved || died) {
      patch.row_idx = updated.row;
      patch.col_idx = updated.col;
      patch.alive = updated.alive;
    }
    if (needsReveal) {
      patch.revealed_rank = updated.rank;
    }
    await supabase.from("pieces").update(patch).eq("id", updated.id);
  }

  await supabase
    .from("games")
    .update({
      current_turn_slot: result.newState.currentTurnSlot,
      turn_number: game.turn_number + 1,
      status: result.newState.status,
      winner_slot: result.winnerSlot ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);

  return new Response(
    JSON.stringify({ ok: true, combatResult: result.combatResult, winnerSlot: result.winnerSlot }),
    { headers: { "Content-Type": "application/json" } },
  );
});
