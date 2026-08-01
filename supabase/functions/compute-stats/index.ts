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

  // === MATERIAL CURVE (per-game, computed once) ===
  const curveP1: number[] = [];
  const curveP2: number[] = [];
  let diffP1 = 0;
  for (const m of moves) {
    if (m.move_type !== "attack" || !m.outcome) continue;
    const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
    const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;

    if (m.player_slot === 1) {
      if (m.outcome === "ATTACKER_WINS") diffP1 += defenderVal;
      else if (m.outcome === "DEFENDER_WINS") diffP1 -= attackerVal;
      else if (m.outcome === "TIE") diffP1 -= attackerVal;
    } else {
      if (m.outcome === "ATTACKER_WINS") diffP1 -= defenderVal;
      else if (m.outcome === "DEFENDER_WINS") diffP1 += attackerVal;
      else if (m.outcome === "TIE") diffP1 += attackerVal;
    }
    curveP1.push(diffP1);
    curveP2.push(-diffP1);
  }

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

    // === REVEAL-SET REPLAY ===
    const revealedEnemyIds = new Set<string>();
    let revealAttacks = 0;
    let revealWins = 0;
    let revealThenKill = 0;
    let revealTotal = 0;
    let avengeKills = 0;
    let avengeOpportunities = 0;
    let spyFirstCombatMove: number | null = null;
    let scoutDistance = 0;

    const killedByEnemy = new Map<string, string[]>();
    const firstRevealedByMe = new Set<string>();

    for (const m of moves) {
      const isMyAttack = m.player_slot === slot && m.move_type === "attack";
      const isEnemyAttack = m.player_slot !== slot && m.move_type === "attack";

      if (m.player_slot === slot) {
        const piece = pieceById.get(m.piece_id);
        if (piece?.rank === R.SCOUT) {
          scoutDistance += Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
        }
      }

      if (spyFirstCombatMove === null && m.move_type === "attack") {
        if (m.player_slot === slot && m.attacker_rank === R.SPY) {
          spyFirstCombatMove = m.move_number;
        } else if (m.player_slot !== slot && m.defender_piece_id) {
          const defPiece = pieceById.get(m.defender_piece_id);
          if (defPiece?.player_slot === slot && defPiece?.rank === R.SPY) {
            spyFirstCombatMove = m.move_number;
          }
        }
      }

      if (!m.defender_piece_id) continue;

      if (isMyAttack) {
        const wasRevealed = revealedEnemyIds.has(m.defender_piece_id);
        if (!wasRevealed) {
          revealAttacks++;
          if (m.outcome === "ATTACKER_WINS") revealWins++;
          revealedEnemyIds.add(m.defender_piece_id);
          firstRevealedByMe.add(m.defender_piece_id);
          revealTotal++;
        }
      } else if (isEnemyAttack) {
        revealedEnemyIds.add(m.piece_id);
        if (!firstRevealedByMe.has(m.piece_id)) {
          firstRevealedByMe.add(m.piece_id);
          revealTotal++;
        }

        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const defPiece = pieceById.get(m.defender_piece_id);
          if (defPiece?.player_slot === slot) {
            if (!killedByEnemy.has(m.piece_id)) killedByEnemy.set(m.piece_id, []);
            killedByEnemy.get(m.piece_id)!.push(m.defender_piece_id);
            avengeOpportunities++;
          }
        }
      }

      if (isMyAttack && m.outcome === "ATTACKER_WINS" && killedByEnemy.has(m.defender_piece_id)) {
        avengeKills++;
      }
      if (isEnemyAttack && m.outcome === "DEFENDER_WINS" && killedByEnemy.has(m.piece_id)) {
        avengeKills++;
      }
    }

    for (const enemyId of firstRevealedByMe) {
      const ep = pieceById.get(enemyId);
      if (ep && !ep.alive) revealThenKill++;
    }

    // === TRADE EFFICIENCY ===
    let tradeValue = 0;
    for (const m of moves) {
      if (m.move_type !== "attack" || !m.outcome) continue;
      const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
      const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;

      if (m.player_slot === slot) {
        if (m.outcome === "ATTACKER_WINS") tradeValue += defenderVal;
        else if (m.outcome === "DEFENDER_WINS") tradeValue -= attackerVal;
        else if (m.outcome === "TIE") tradeValue -= attackerVal;
      } else {
        if (m.outcome === "DEFENDER_WINS") tradeValue += attackerVal;
        else if (m.outcome === "ATTACKER_WINS") tradeValue -= defenderVal;
        else if (m.outcome === "TIE") tradeValue -= defenderVal;
      }
    }

    // === COMEBACK DELTA ===
    let materialDiff = 0;
    let maxDeficit = 0;
    for (const m of moves) {
      if (m.move_type !== "attack" || !m.outcome) continue;
      const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
      const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;

      if (m.player_slot === slot) {
        if (m.outcome === "ATTACKER_WINS") materialDiff += defenderVal;
        else if (m.outcome === "DEFENDER_WINS") materialDiff -= attackerVal;
        else if (m.outcome === "TIE") {
          materialDiff -= attackerVal;
          materialDiff += defenderVal;
        }
      } else {
        if (m.outcome === "ATTACKER_WINS") materialDiff -= defenderVal;
        else if (m.outcome === "DEFENDER_WINS") materialDiff += attackerVal;
        else if (m.outcome === "TIE") {
          materialDiff += attackerVal;
          materialDiff -= defenderVal;
        }
      }
      if (materialDiff < maxDeficit) maxDeficit = materialDiff;
    }
    const comebackDelta = won && maxDeficit < 0 ? Math.abs(maxDeficit) : 0;

    // === COMBAT HEATMAP ===
    const heatmap: Record<string, { attacks: number; wins: number }> = {
      ...(stats.attack_heatmap ?? {}),
    };
    for (const m of moves) {
      if (m.player_slot === slot && m.move_type === "attack") {
        const key = `${m.to_row},${m.to_col}`;
        if (!heatmap[key]) heatmap[key] = { attacks: 0, wins: 0 };
        heatmap[key].attacks++;
        if (m.outcome === "ATTACKER_WINS") heatmap[key].wins++;
      }
    }

    // === PIECE FATE / SIGNATURE WEAPONS ===
    const killsByRank: Record<string, number> = { ...(stats.kills_by_rank ?? {}) };
    const deathsByRank: Record<string, number> = { ...(stats.deaths_by_rank ?? {}) };

    for (const m of moves) {
      if (m.move_type !== "attack" || !m.outcome) continue;

      if (m.player_slot === slot) {
        if (m.outcome === "ATTACKER_WINS" && m.attacker_rank) {
          killsByRank[m.attacker_rank] = (killsByRank[m.attacker_rank] ?? 0) + 1;
        }
        if (m.outcome === "DEFENDER_WINS" && m.attacker_rank) {
          deathsByRank[m.defender_rank ?? "?"] = (deathsByRank[m.defender_rank ?? "?"] ?? 0) + 1;
        }
      } else {
        if (m.outcome === "DEFENDER_WINS" && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          if (dp?.player_slot === slot && dp.rank) {
            killsByRank[dp.rank] = (killsByRank[dp.rank] ?? 0) + 1;
          }
        }
        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          if (dp?.player_slot === slot) {
            deathsByRank[m.attacker_rank ?? "?"] = (deathsByRank[m.attacker_rank ?? "?"] ?? 0) + 1;
          }
        }
      }
    }

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

    const rivalWins: Record<string, number> = stats.career_rival_wins ?? {};
    rivalWins[oppId] = (rivalWins[oppId] ?? 0) + (won ? 1 : 0);

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
        reveal_attacks: stats.reveal_attacks + revealAttacks,
        reveal_wins: stats.reveal_wins + revealWins,
        scout_distance: stats.scout_distance + scoutDistance,
        avenge_kills: stats.avenge_kills + avengeKills,
        avenge_opportunities: stats.avenge_opportunities + avengeOpportunities,
        spy_timing_sum: stats.spy_timing_sum + (spyFirstCombatMove ?? 0),
        spy_timing_games: stats.spy_timing_games + (spyFirstCombatMove !== null ? 1 : 0),
        max_comeback_deficit: Math.max(stats.max_comeback_deficit ?? 0, comebackDelta),
        reveal_then_kill: stats.reveal_then_kill + revealThenKill,
        reveal_total: stats.reveal_total + revealTotal,
        trade_efficiency_sum: stats.trade_efficiency_sum + tradeValue,
        trade_efficiency_count: stats.trade_efficiency_count + combatsTotal,
        career_kingmakers: stats.career_kingmakers + (spyKills > 0 ? 1 : 0),
        career_rival_wins: rivalWins,
        attack_heatmap: heatmap,
        kills_by_rank: killsByRank,
        deaths_by_rank: deathsByRank,
        updated_at: new Date().toISOString(),
      })
      .eq("player_id", playerId);

    if (statsUpdateError) {
      return jsonResponse({ error: "STATS_UPDATE_FAILED", detail: statsUpdateError.message }, 500);
    }

    // Archetype refresh every 5 games
    if (newGamesPlayed % 5 === 0 && newGamesPlayed >= 5) {
      const updatedStats = {
        ...stats,
        reveal_attacks: stats.reveal_attacks + revealAttacks,
        reveal_wins: stats.reveal_wins + revealWins,
        forward_moves: stats.forward_moves + forwardMoves,
        total_moves: stats.total_moves + playerMoves.length,
        combats_initiated: stats.combats_initiated + combatsAsAttacker,
        combats_total: stats.combats_total + combatsTotal,
        bombs_detonated: stats.bombs_detonated + bombsDetonated,
        total_bombs: stats.total_bombs + myBombs.length,
        scout_distance: stats.scout_distance + scoutDistance,
        scout_moves: stats.scout_moves + scoutMoves,
        marathon_wins: stats.marathon_wins + (isMarathon && won ? 1 : 0),
        marathon_games: stats.marathon_games + (isMarathon ? 1 : 0),
        avenge_kills: stats.avenge_kills + avengeKills,
        avenge_opportunities: stats.avenge_opportunities + avengeOpportunities,
        trade_efficiency_sum: stats.trade_efficiency_sum + tradeValue,
        trade_efficiency_count: stats.trade_efficiency_count + combatsTotal,
        spy_kills: stats.spy_kills + spyKills,
        first_bloods: stats.first_bloods + (gotFirstBlood ? 1 : 0),
        miners_survived: stats.miners_survived + minersSurvived,
        miners_started: stats.miners_started + myMiners.length,
        attacks_total: stats.attacks_total + myAttacks.length,
      };

      const aggression = updatedStats.total_moves > 0
        ? updatedStats.forward_moves / updatedStats.total_moves
        : 0;
      const initiative = updatedStats.combats_total > 0
        ? updatedStats.combats_initiated / updatedStats.combats_total
        : 0;
      const revealEff = updatedStats.reveal_attacks > 0
        ? updatedStats.reveal_wins / updatedStats.reveal_attacks
        : 0;
      const bombEff = updatedStats.total_bombs > 0
        ? updatedStats.bombs_detonated / updatedStats.total_bombs
        : 0;
      const marathonWR = updatedStats.marathon_games > 0
        ? updatedStats.marathon_wins / updatedStats.marathon_games
        : 0;
      const scoutTempo = updatedStats.scout_moves > 0
        ? updatedStats.scout_distance / updatedStats.scout_moves
        : 0;
      const avengeRate = updatedStats.avenge_opportunities > 0
        ? updatedStats.avenge_kills / updatedStats.avenge_opportunities
        : 0;
      const minerSurv = updatedStats.miners_started > 0
        ? updatedStats.miners_survived / updatedStats.miners_started
        : 0;
      const totalGames = newWins + newLosses + newDraws;
      const firstBloodRate = totalGames > 0 ? updatedStats.first_bloods / totalGames : 0;
      const unknownPressure = updatedStats.attacks_total > 0
        ? updatedStats.reveal_attacks / updatedStats.attacks_total
        : 0;

      const scores: Record<string, number> = {
        brawler: aggression * 3 + initiative * 2 + firstBloodRate,
        trapper: bombEff * 3 + (1 - aggression) * 2 + avengeRate,
        scout_main: (scoutTempo / 5) * 3 + revealEff * 2 + unknownPressure,
        grinder: marathonWR * 3 + (1 - aggression) * 2 + minerSurv,
        assassin: (updatedStats.spy_kills > 0 ? 1 : 0) * 2 + firstBloodRate * 2 + unknownPressure * 2,
        fortress: (1 - aggression) * 2 + minerSurv * 2 + bombEff * 2,
      };

      const archetype = Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0];

      const { error: archetypeUpdateError } = await supabase
        .from("player_stats")
        .update({
          archetype,
          archetype_updated_at: new Date().toISOString(),
        })
        .eq("player_id", playerId);

      if (archetypeUpdateError) {
        return jsonResponse({ error: "ARCHETYPE_UPDATE_FAILED", detail: archetypeUpdateError.message }, 500);
      }
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

    // --- NEW ACHIEVEMENTS ---

    // Ghost Protocol: Win without Marshal or General entering combat
    const marshalOrGenInCombat = moves.some((m: Move) => {
      if (m.player_slot === slot) {
        return m.attacker_rank === R.MARSHAL || m.attacker_rank === R.GENERAL;
      }
      if (m.player_slot !== slot && m.defender_piece_id) {
        const dp = pieceById.get(m.defender_piece_id);
        return dp?.player_slot === slot && (dp.rank === R.MARSHAL || dp.rank === R.GENERAL);
      }
      return false;
    });
    if (won && !marshalOrGenInCombat) newAchievements.push("ghost_protocol");

    // Phoenix: Win after losing your Marshal
    const myMarshal = playerPieces.find((p: Piece) => p.rank === R.MARSHAL);
    if (won && myMarshal && !myMarshal.alive) newAchievements.push("phoenix");

    // Vendetta: In one game, an enemy piece kills yours, then you later kill that same piece (3+ times)
    if (avengeKills >= 3) newAchievements.push("vendetta");

    // Counterintel: Kill enemy Spy before your Marshal enters any combat
    const enemySpy = enemyPieces.find((p: Piece) => p.rank === R.SPY);
    const enemySpyDead = enemySpy && !enemySpy.alive;
    if (enemySpyDead && won) {
      const spyDeathMove = moves.find((m: Move) =>
        (m.defender_piece_id === enemySpy.id && m.outcome === "ATTACKER_WINS") ||
        (m.piece_id === enemySpy.id && m.outcome === "DEFENDER_WINS")
      );
      const marshalFirstCombat = moves.find((m: Move) => {
        if (m.player_slot === slot && m.attacker_rank === R.MARSHAL) return true;
        if (m.player_slot !== slot && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          return dp?.player_slot === slot && dp.rank === R.MARSHAL;
        }
        return false;
      });
      if (spyDeathMove && (!marshalFirstCombat || spyDeathMove.move_number < marshalFirstCombat.move_number)) {
        newAchievements.push("counterintel");
      }
    }

    // Fortress Breaker: Defuse 3+ bombs AND capture the Flag in same game
    if (won && bombDefuses >= 3 && lastMove?.defender_rank === R.FLAG) {
      newAchievements.push("fortress_breaker");
    }

    // Silent General: Win without initiating any attack in first 15 moves
    const earlyAttacks = moves.filter((m: Move) =>
      m.player_slot === slot && m.move_type === "attack" && m.move_number <= 15
    ).length;
    if (won && earlyAttacks === 0) newAchievements.push("silent_general");

    // Nemesis: Beat opponent rated 200+ higher
    if (won && opponent.rating - player.rating >= 200) newAchievements.push("nemesis");

    // Serial Killer (career): 3+ games where spy kills Marshal
    if (stats.career_kingmakers + (spyKills > 0 ? 1 : 0) >= 3) {
      newAchievements.push("serial_killer");
    }

    // Perfect Deminer: Defuse all enemy bombs (6) without losing any Miner to a bomb
    const minersLostToBombs = moves.filter((m: Move) =>
      m.player_slot === slot && m.attacker_rank === R.MINER &&
      m.defender_rank === R.BOMB && m.outcome === "DEFENDER_WINS"
    ).length;
    if (bombDefuses >= 6 && minersLostToBombs === 0) newAchievements.push("perfect_deminer");

    // Counterpunch: Win after being behind by ≥15 rank-value points
    if (won && comebackDelta >= 15) newAchievements.push("counterpunch");

    // Rival Hunter: Beat same opponent 5+ times (career)
    if (rivalWins[oppId] >= 5) newAchievements.push("rival_hunter");

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

  await supabase.from("game_summaries").upsert(
    {
      game_id,
      material_curve_p1: curveP1,
      material_curve_p2: curveP2,
    },
    { onConflict: "game_id" },
  );

  await supabase.from("games").update({ stats_computed: true }).eq("id", game_id);

  return jsonResponse({ ok: true });
});
