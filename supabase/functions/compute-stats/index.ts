// supabase/functions/compute-stats/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Internal rank constants matching supabase/functions/_shared/rules/pieces.js
// Lower number = stronger. Stored as strings in pieces.rank and moves columns.
const R = {
  MARSHAL: "1",
  GENERAL: "2",
  COLONEL: "3",
  MAJOR: "4",
  CAPTAIN: "5",
  LIEUTENANT: "6",
  SERGEANT: "7",
  MINER: "8",
  SCOUT: "9",
  SPY: "10",
  BOMB: "BOMB",
  FLAG: "FLAG",
} as const;

// Strategic value (for potential future trade efficiency / deficit calculations)
const RANK_VALUE: Record<string, number> = {
  [R.MARSHAL]: 10,
  [R.GENERAL]: 9,
  [R.COLONEL]: 8,
  [R.MAJOR]: 7,
  [R.CAPTAIN]: 6,
  [R.LIEUTENANT]: 5,
  [R.SERGEANT]: 4,
  [R.MINER]: 3,
  [R.SCOUT]: 2,
  [R.SPY]: 2,
  [R.BOMB]: 5,
  [R.FLAG]: 0,
};

function kFactor(gamesPlayed: number, rating: number): number {
  if (rating >= 2200) return 16;
  if (gamesPlayed <= 20) return 56;
  if (gamesPlayed <= 100) return 32;
  return 20;
}

function computeElo(rSelf: number, rOpp: number, score: number, k: number): number {
  const expected = 1 / (1 + Math.pow(10, (rOpp - rSelf) / 400));
  return Math.max(100, Math.round(rSelf + k * (score - expected)));
}

interface Move {
  piece_id: string;
  player_slot: number;
  from_row: number;
  from_col: number;
  to_row: number;
  to_col: number;
  move_type: string;
  outcome: string | null;
  attacker_rank: string | null;
  defender_rank: string | null;
  defender_piece_id: string | null;
  move_number: number;
}

interface Piece {
  id: string;
  player_slot: number;
  rank: string;
  alive: boolean;
}

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

  let body: { game_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, 400);
  }

  const { game_id } = body;
  if (!game_id) {
    return jsonResponse({ error: "MISSING_GAME_ID" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("*")
    .eq("id", game_id)
    .single();

  if (gameError || !game) {
    return jsonResponse({ error: "GAME_NOT_FOUND" }, 404);
  }

  if (game.status !== "finished") {
    return jsonResponse({ error: "GAME_NOT_FINISHED" }, 400);
  }

  if (game.stats_computed) {
    return jsonResponse({ ok: true, skipped: "already_computed" });
  }

  if (!game.player1_id || !game.player2_id) {
    return jsonResponse({ ok: true, skipped: "anonymous_players" });
  }

  if (game.is_bot_game) {
    return jsonResponse({ ok: true, skipped: "bot_game" });
  }

  const { data: moves, error: movesError } = await supabase
    .from("moves")
    .select("*")
    .eq("game_id", game_id)
    .order("move_number", { ascending: true });

  const { data: pieces, error: piecesError } = await supabase
    .from("pieces")
    .select("id, player_slot, rank, alive")
    .eq("game_id", game_id);

  if (movesError || piecesError || !moves || !pieces) {
    return jsonResponse({ error: "DATA_LOAD_FAILED" }, 500);
  }

  const totalMoves = moves.length;
  const isRated = moves.some((m: Move) => m.move_type === "attack");

  if (!isRated) {
    return jsonResponse({ ok: true, skipped: "no_combat_unrated" });
  }

  const pieceById = new Map(pieces.map((p: Piece) => [p.id, p]));
  const firstCombat = moves.find((m: Move) => m.move_type === "attack");
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  const isMarathon = totalMoves > 60;
  const marshalFights = moves.filter(
    (m: Move) => m.attacker_rank === R.MARSHAL && m.defender_rank === R.MARSHAL,
  );

  for (const slot of [1, 2] as const) {
    const playerId = slot === 1 ? game.player1_id : game.player2_id;
    const oppId = slot === 1 ? game.player2_id : game.player1_id;

    const { data: player } = await supabase.from("players").select("*").eq("id", playerId).single();
    const { data: opponent } = await supabase
      .from("players")
      .select("rating, games_played")
      .eq("id", oppId)
      .single();
    const { data: stats } = await supabase
      .from("player_stats")
      .select("*")
      .eq("player_id", playerId)
      .single();

    if (!player || !opponent || !stats) continue;

    const won = game.winner_slot === slot;
    const lost = game.winner_slot !== null && game.winner_slot !== slot;
    const draw = game.winner_slot === null;

    const playerMoves = moves.filter((m: Move) => m.player_slot === slot);
    const playerPieces = pieces.filter((p: Piece) => p.player_slot === slot);
    const enemyPieces = pieces.filter((p: Piece) => p.player_slot !== slot);

    const forwardMoves = playerMoves.filter((m: Move) => {
      if (slot === 1) return m.to_row > m.from_row;
      return m.to_row < m.from_row;
    }).length;

    const enemyHalfMoves = playerMoves.filter((m: Move) => {
      if (slot === 1) return m.to_row >= 5;
      return m.to_row <= 4;
    }).length;

    const lateralNonCombat = playerMoves.filter(
      (m: Move) => m.to_row === m.from_row && m.move_type !== "attack",
    ).length;

    const myAttacks = playerMoves.filter((m: Move) => m.move_type === "attack");
    const combatsAsAttacker = myAttacks.length;
    const combatsAsDefender = moves.filter(
      (m: Move) => m.player_slot !== slot && m.move_type === "attack",
    ).length;
    const combatsTotal = combatsAsAttacker + combatsAsDefender;

    const spyCombats = moves.filter((m: Move) => {
      if (m.player_slot === slot && m.attacker_rank === R.SPY) return true;
      if (m.player_slot !== slot && m.defender_rank === R.SPY) {
        const defender = m.defender_piece_id ? pieceById.get(m.defender_piece_id) : undefined;
        return defender?.player_slot === slot;
      }
      return false;
    }).length;

    const spyKills = moves.filter(
      (m: Move) =>
        m.player_slot === slot && m.attacker_rank === R.SPY && m.outcome === "ATTACKER_WINS",
    ).length;

    const myBombs = playerPieces.filter((p: Piece) => p.rank === R.BOMB);
    const bombsDetonated = moves.filter(
      (m: Move) =>
        m.player_slot !== slot &&
        m.move_type === "attack" &&
        m.defender_rank === R.BOMB &&
        m.outcome === "DEFENDER_WINS",
    ).length;

    const myMiners = playerPieces.filter((p: Piece) => p.rank === R.MINER);
    const minersSurvived = myMiners.filter((p: Piece) => p.alive).length;

    const gotFirstBlood = firstCombat ? firstCombat.player_slot === slot : false;

    const scoutMoves = playerMoves.filter((m: Move) => {
      const piece = pieceById.get(m.piece_id);
      return piece?.rank === R.SCOUT;
    }).length;

    const enemyDead = enemyPieces.filter((p: Piece) => !p.alive).length;
    const ownPiecesLost = playerPieces.filter((p: Piece) => !p.alive).length;

    const marshalShowdowns = marshalFights.length;
    const marshalShowdownWins = marshalFights.filter((m: Move) =>
      (m.player_slot === slot && m.outcome === "ATTACKER_WINS") ||
      (m.player_slot !== slot && m.outcome === "DEFENDER_WINS")
    ).length;

    let winByFlag = 0;
    let winByResign = 0;
    let winByNomoves = 0;
    if (won) {
      const enemyFlag = enemyPieces.find((p: Piece) => p.rank === R.FLAG);
      if (enemyFlag && !enemyFlag.alive) {
        winByFlag = 1;
      } else {
        const enemyMobilePieces = enemyPieces.filter(
          (p: Piece) => p.alive && p.rank !== R.BOMB && p.rank !== R.FLAG,
        );
        if (enemyMobilePieces.length === 0) {
          winByNomoves = 1;
        } else {
          winByResign = 1;
        }
      }
    }

    const newWins = stats.wins + (won ? 1 : 0);
    const newLosses = stats.losses + (lost ? 1 : 0);
    const newDraws = stats.draws + (draw ? 1 : 0);
    const newStreak = won ? stats.current_streak + 1 : 0;
    const newLongestStreak = Math.max(stats.longest_streak, newStreak);
    const newFastestWinRaw = won ? Math.min(stats.fastest_win ?? Infinity, totalMoves) : stats.fastest_win;
    const newFastestWin = newFastestWinRaw === Infinity ? null : newFastestWinRaw;
    const newLongestGame = Math.max(stats.longest_game ?? 0, totalMoves);
    const newMostCaptures = Math.max(stats.most_captures ?? 0, enemyDead);

    const score = won ? 1 : (draw ? 0.5 : 0);
    const k = kFactor(player.games_played, player.rating);
    const newRating = computeElo(player.rating, opponent.rating, score, k);
    const newGamesPlayed = player.games_played + 1;
    const newProvisional = newGamesPlayed < 20;

    const { error: playerUpdateError } = await supabase
      .from("players")
      .update({
        rating: newRating,
        games_played: newGamesPlayed,
        rating_provisional: newProvisional,
      })
      .eq("id", playerId);

    if (playerUpdateError) {
      return jsonResponse({ error: "PLAYER_UPDATE_FAILED", detail: playerUpdateError.message }, 500);
    }

    const { error: statsUpdateError } = await supabase
      .from("player_stats")
      .update({
        wins: newWins,
        losses: newLosses,
        draws: newDraws,
        current_streak: newStreak,
        longest_streak: newLongestStreak,
        fastest_win: newFastestWin,
        longest_game: newLongestGame,
        most_captures: newMostCaptures,
        total_moves_all_games: stats.total_moves_all_games + totalMoves,
        spy_combats: stats.spy_combats + spyCombats,
        spy_kills: stats.spy_kills + spyKills,
        bombs_detonated: stats.bombs_detonated + bombsDetonated,
        total_bombs: stats.total_bombs + myBombs.length,
        miners_survived: stats.miners_survived + minersSurvived,
        miners_started: stats.miners_started + myMiners.length,
        first_bloods: stats.first_bloods + (gotFirstBlood ? 1 : 0),
        combats_initiated: stats.combats_initiated + combatsAsAttacker,
        combats_total: stats.combats_total + combatsTotal,
        forward_moves: stats.forward_moves + forwardMoves,
        total_moves: stats.total_moves + playerMoves.length,
        moves_in_enemy_half: stats.moves_in_enemy_half + enemyHalfMoves,
        scout_moves: stats.scout_moves + scoutMoves,
        attacks_on_unknown: stats.attacks_on_unknown + myAttacks.length,
        attacks_total: stats.attacks_total + myAttacks.length,
        lateral_non_combat_moves: stats.lateral_non_combat_moves + lateralNonCombat,
        opponent_pieces_captured: stats.opponent_pieces_captured + enemyDead,
        own_pieces_lost: stats.own_pieces_lost + ownPiecesLost,
        active_moves: stats.active_moves + forwardMoves + myAttacks.length,
        wins_by_flag: stats.wins_by_flag + winByFlag,
        wins_by_resign: stats.wins_by_resign + winByResign,
        wins_by_nomoves: stats.wins_by_nomoves + winByNomoves,
        marathon_games: stats.marathon_games + (isMarathon ? 1 : 0),
        marathon_wins: stats.marathon_wins + (isMarathon && won ? 1 : 0),
        marshal_showdowns: stats.marshal_showdowns + marshalShowdowns,
        marshal_showdown_wins: stats.marshal_showdown_wins + marshalShowdownWins,
        updated_at: new Date().toISOString(),
      })
      .eq("player_id", playerId);

    if (statsUpdateError) {
      return jsonResponse({ error: "STATS_UPDATE_FAILED", detail: statsUpdateError.message }, 500);
    }

    const aliveCount = playerPieces.filter((p: Piece) => p.alive).length;
    const bombDefuses = playerMoves.filter(
      (m: Move) =>
        m.attacker_rank === R.MINER && m.defender_rank === R.BOMB && m.outcome === "ATTACKER_WINS",
    ).length;
    const enemyScoutsDead = enemyPieces.filter((p: Piece) => p.rank === R.SCOUT && !p.alive).length;
    const highPiecesLost = playerPieces.filter(
      (p: Piece) => !p.alive && [R.MARSHAL, R.GENERAL, R.COLONEL].includes(p.rank as typeof R.MARSHAL),
    ).length;

    const newAchievements: string[] = [];
    if (spyKills > 0) newAchievements.push("kingmaker");
    if (bombDefuses >= 3) newAchievements.push("bomb_squad");
    if (won && lastMove?.attacker_rank === R.MINER && lastMove?.defender_rank === R.FLAG) {
      newAchievements.push("needle_threader");
    }
    if (won && aliveCount <= 8) newAchievements.push("glass_cannon");
    if (won && ownPiecesLost <= 10) newAchievements.push("clean_operation");
    if (won && totalMoves <= 30) newAchievements.push("blitz_general");
    if (enemyScoutsDead === 8) newAchievements.push("no_fly_zone");
    if (bombsDetonated >= 4) newAchievements.push("minefield_architect");
    if (won && highPiecesLost === 0) newAchievements.push("iron_wall");
    if (won && myAttacks.length >= 10) newAchievements.push("fog_walker");

    if (newAchievements.length > 0) {
      const { error: achievementsError } = await supabase.from("achievements").upsert(
        newAchievements.map((key) => ({
          player_id: playerId,
          achievement_key: key,
          game_id,
        })),
        { onConflict: "player_id,achievement_key", ignoreDuplicates: true },
      );

      if (achievementsError) {
        return jsonResponse({ error: "ACHIEVEMENTS_UPDATE_FAILED", detail: achievementsError.message }, 500);
      }
    }
  }

  await supabase.from("games").update({ stats_computed: true }).eq("id", game_id);

  return jsonResponse({ ok: true });
});
