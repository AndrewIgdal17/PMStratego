// supabase/functions/compute-stats/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  binPhaseEvents,
  computeInfoArchetype,
  emptyPhaseBin,
  emptyPhaseStats,
  mergeIwPhaseFields,
  mergeMemoryScoutingWithCareer,
  mergePhaseCareer,
  runInformationWarfarePass,
  topMemoryMoments,
  type MemoryEvent,
  type MoveLike,
  type PhaseBin,
  type PhaseStatsStory,
  type PieceLike,
} from "../_shared/information-warfare.ts";

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

function mergePhaseBin(target: PhaseBin, delta: PhaseBin): void {
  target.reveal_attacks += delta.reveal_attacks;
  target.reveal_wins += delta.reveal_wins;
  target.trade_sum += delta.trade_sum;
  target.trade_count += delta.trade_count;
  target.attacks += delta.attacks;
  target.attack_wins += delta.attack_wins;
  target.avenge_kills += delta.avenge_kills;
  target.avenge_opportunities += delta.avenge_opportunities;
  target.memory_hits_w += delta.memory_hits_w;
  target.memory_misses_w += delta.memory_misses_w;
  target.deduction_latency_sum += delta.deduction_latency_sum;
  target.deduction_latency_count += delta.deduction_latency_count;
}

function mergePhaseStats(target: PhaseStatsStory, delta: PhaseStatsStory): void {
  for (const lens of ["by_capture_quarter", "by_material_state", "by_info_state"] as const) {
    for (const key of Object.keys(target[lens])) {
      mergePhaseBin(
        target[lens][key as keyof typeof target[typeof lens]],
        delta[lens][key as keyof typeof delta[typeof lens]],
      );
    }
  }
}

/** Quartile of captures completed so far (captures BEFORE current combat). */
function captureQuarter(capturesSoFar: number, totalCaptures: number): "q1" | "q2" | "q3" | "q4" {
  if (totalCaptures <= 0) return "q1";
  const pct = capturesSoFar / totalCaptures;
  if (pct < 0.25) return "q1";
  if (pct < 0.5) return "q2";
  if (pct < 0.75) return "q3";
  return "q4";
}

function materialState(diff: number): "behind" | "even" | "ahead" | "dominant" {
  if (diff < -5) return "behind";
  if (diff <= 5) return "even";
  if (diff <= 15) return "ahead";
  return "dominant";
}

/** deep_fog < 5; partial 5–14; known >= 15 */
function infoState(knownCount: number): "deep_fog" | "partial" | "known" {
  if (knownCount < 5) return "deep_fog";
  if (knownCount < 15) return "partial";
  return "known";
}

/**
 * Last index where curve sign permanently flips to the final sign.
 * combatMoves = attack moves with outcomes, same order as curve samples.
 */
function findTurningPoint(
  curve: number[],
  combatMoves: Move[],
): { move_number: number; combat_index: number } | null {
  if (curve.length < 2 || combatMoves.length !== curve.length) return null;
  let lastCrossIndex: number | null = null;
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    if (curr === 0) continue;
    if (prev === 0 || Math.sign(prev) !== Math.sign(curr)) {
      lastCrossIndex = i;
    }
  }
  if (lastCrossIndex === null) return null;
  const finalSign = Math.sign(curve[curve.length - 1]);
  if (finalSign === 0) return null;
  for (let i = lastCrossIndex; i < curve.length; i++) {
    if (curve[i] !== 0 && Math.sign(curve[i]) !== finalSign) return null;
  }
  return {
    move_number: combatMoves[lastCrossIndex].move_number,
    combat_index: lastCrossIndex,
  };
}

function invasionLane(col: number): "left" | "center" | "right" {
  if (col <= 3) return "left";
  if (col <= 5) return "center";
  return "right";
}

/** True when this combat is a capture (kill) for `slot`. */
function isCaptureForSlot(m: Move, slot: number, pieceById: Map<string, Piece>): boolean {
  if (m.move_type !== "attack" || !m.outcome) return false;
  if (m.player_slot === slot && m.outcome === "ATTACKER_WINS") return true;
  if (m.player_slot !== slot && m.outcome === "DEFENDER_WINS" && m.defender_piece_id) {
    const dp = pieceById.get(m.defender_piece_id);
    return dp?.player_slot === slot;
  }
  return false;
}

/** Clean kill: ATTACKER_WINS or DEFENDER_WINS where defender is not Bomb (excludes defuses/trades). */
function isCleanKill(m: Move): boolean {
  if (m.move_type !== "attack" || !m.outcome) return false;
  if (m.outcome === "TIE") return false;
  return m.defender_rank !== R.BOMB;
}

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
  created_at?: string;
}

interface Piece {
  id: string;
  player_slot: number;
  rank: string;
  alive: boolean;
  row_idx: number;
  col_idx: number;
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
    .select("id, player_slot, rank, alive, row_idx, col_idx")
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

  // === PER-GAME STORY (game-wide, before per-slot loop) ===
  const phaseStatsBySlot: Record<1 | 2, PhaseStatsStory> = {
    1: emptyPhaseStats(),
    2: emptyPhaseStats(),
  };
  const memoryEventsBySlot: Record<1 | 2, MemoryEvent[]> = { 1: [], 2: [] };
  const memoryScoresBySlot: { slot1: number | null; slot2: number | null } = {
    slot1: null,
    slot2: null,
  };
  const pieceByIdIw = new Map<string, PieceLike>(
    (pieces as Piece[]).map((p) => [p.id, p]),
  );

  const combatMoves = moves.filter(
    (m: Move) => m.move_type === "attack" && m.outcome,
  ) as Move[];

  const pieceStats = new Map<
    string,
    {
      moves_made: number;
      kills: number;
      distance: number;
      first_move: number | null;
      death_move: number | null;
    }
  >();
  for (const p of pieces) {
    pieceStats.set(p.id, {
      moves_made: 0,
      kills: 0,
      distance: 0,
      first_move: null,
      death_move: null,
    });
  }

  const killChains = {
    1: { current: 0, best: 0, bestStart: 0, bestEnd: 0, curStart: 0 },
    2: { current: 0, best: 0, bestStart: 0, bestEnd: 0, curStart: 0 },
  };

  let firstCasualty: {
    rank: string;
    player_slot: number;
    move_number: number;
    killed_by_rank: string;
  } | null = null;

  // Running positions + alive-at-time (INVARIANT 4)
  const positionsByPiece = new Map<string, { row: number; col: number }>();
  // Seed with current piece coords (setup for unmoved pieces, including Flag/Bomb)
  for (const p of pieces as Piece[]) {
    positionsByPiece.set(p.id, { row: p.row_idx, col: p.col_idx });
  }
  const aliveSet = new Set((pieces as Piece[]).map((p) => p.id));
  const territoryTimeline: Array<{
    move_number: number;
    p1_in_enemy: number;
    p2_in_enemy: number;
  }> = [];

  const infoEdgeBySlot: { slot1: number[]; slot2: number[] } = {
    slot1: [],
    slot2: [],
  };

  function recordDeath(pieceId: string, moveNumber: number): void {
    const ps = pieceStats.get(pieceId);
    if (ps && ps.death_move === null) ps.death_move = moveNumber;
    aliveSet.delete(pieceId);
  }

  function bumpKillChain(winnerSlot: 1 | 2, moveNumber: number): void {
    const loserSlot = (winnerSlot === 1 ? 2 : 1) as 1 | 2;
    const kc = killChains[winnerSlot];
    kc.current++;
    if (kc.current === 1) kc.curStart = moveNumber;
    if (kc.current > kc.best) {
      kc.best = kc.current;
      kc.bestStart = kc.curStart;
      kc.bestEnd = moveNumber;
    }
    killChains[loserSlot].current = 0;
  }

  function applyCombatDeaths(m: Move): void {
    if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
      recordDeath(m.defender_piece_id, m.move_number);
    } else if (m.outcome === "DEFENDER_WINS") {
      recordDeath(m.piece_id, m.move_number);
    } else if (m.outcome === "TIE") {
      recordDeath(m.piece_id, m.move_number);
      if (m.defender_piece_id) recordDeath(m.defender_piece_id, m.move_number);
    }
  }

  for (const m of moves as Move[]) {
    const ps = pieceStats.get(m.piece_id);
    if (ps) {
      ps.moves_made++;
      ps.distance += Math.abs(m.to_row - m.from_row) + Math.abs(m.to_col - m.from_col);
      if (ps.first_move === null) ps.first_move = m.move_number;
    }

    positionsByPiece.set(m.piece_id, { row: m.to_row, col: m.to_col });

    if (m.move_type === "attack" && m.outcome) {
      if (!firstCasualty) {
        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          const dp = pieceById.get(m.defender_piece_id);
          if (dp) {
            firstCasualty = {
              rank: dp.rank,
              player_slot: dp.player_slot,
              move_number: m.move_number,
              killed_by_rank: m.attacker_rank ?? "?",
            };
          }
        } else if (m.outcome === "DEFENDER_WINS") {
          const ap = pieceById.get(m.piece_id);
          if (ap) {
            firstCasualty = {
              rank: ap.rank,
              player_slot: ap.player_slot,
              move_number: m.move_number,
              killed_by_rank: m.defender_rank ?? "?",
            };
          }
        } else if (m.outcome === "TIE") {
          const ap = pieceById.get(m.piece_id);
          if (ap) {
            firstCasualty = {
              rank: ap.rank,
              player_slot: ap.player_slot,
              move_number: m.move_number,
              killed_by_rank: m.defender_rank ?? "?",
            };
          }
        }
      }

      applyCombatDeaths(m);

      if (m.outcome === "ATTACKER_WINS") {
        if (isCleanKill(m)) {
          const aps = pieceStats.get(m.piece_id);
          if (aps) aps.kills++;
        }
        bumpKillChain(m.player_slot as 1 | 2, m.move_number);
      } else if (m.outcome === "DEFENDER_WINS") {
        if (isCleanKill(m) && m.defender_piece_id) {
          const dps = pieceStats.get(m.defender_piece_id);
          if (dps) dps.kills++;
        }
        const defSlot = (m.player_slot === 1 ? 2 : 1) as 1 | 2;
        bumpKillChain(defSlot, m.move_number);
      } else {
        killChains[1].current = 0;
        killChains[2].current = 0;
      }

    }

    // Territory sample AFTER combat deaths (INVARIANT 4)
    if (m.move_number % 20 === 0 || m.move_number === totalMoves) {
      let p1InEnemy = 0;
      let p2InEnemy = 0;
      for (const [pid, pos] of positionsByPiece) {
        if (!aliveSet.has(pid)) continue;
        const piece = pieceById.get(pid);
        if (!piece) continue;
        if (piece.player_slot === 1 && pos.row <= 4) p1InEnemy++;
        if (piece.player_slot === 2 && pos.row >= 5) p2InEnemy++;
      }
      territoryTimeline.push({
        move_number: m.move_number,
        p1_in_enemy: p1InEnemy,
        p2_in_enemy: p2InEnemy,
      });
    }
  }

  // Flag proximity: Flag never moves — use pieces.row_idx / col_idx directly
  const flagProximity: Record<1 | 2, number | null> = { 1: null, 2: null };
  for (const s of [1, 2] as const) {
    const flag = (pieces as Piece[]).find((p) => p.player_slot === s && p.rank === R.FLAG);
    if (!flag) continue;
    for (const m of moves as Move[]) {
      if (m.player_slot === s) continue;
      const dist =
        Math.abs(m.to_row - flag.row_idx) + Math.abs(m.to_col - flag.col_idx);
      if (flagProximity[s] === null || dist < (flagProximity[s] as number)) {
        flagProximity[s] = dist;
      }
    }
  }

  // Think times (cap 10 min; skip non-positive / overnight gaps)
  const p1Think: number[] = [];
  const p2Think: number[] = [];
  for (let i = 1; i < moves.length; i++) {
    const prev = moves[i - 1] as Move;
    const curr = moves[i] as Move;
    if (!prev.created_at || !curr.created_at) continue;
    const diff =
      new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    if (diff <= 0 || diff >= 600_000) continue;
    if (curr.player_slot === 1) p1Think.push(diff);
    else p2Think.push(diff);
  }

  const thinkTimes =
    p1Think.length > 0 || p2Think.length > 0
      ? {
          p1_avg_ms: p1Think.length
            ? Math.round(p1Think.reduce((a, b) => a + b, 0) / p1Think.length)
            : null,
          p2_avg_ms: p2Think.length
            ? Math.round(p2Think.reduce((a, b) => a + b, 0) / p2Think.length)
            : null,
          p1_max_ms: p1Think.length ? Math.max(...p1Think) : null,
          p2_max_ms: p2Think.length ? Math.max(...p2Think) : null,
        }
      : null;

  const pieceCareers = (pieces as Piece[]).map((p) => {
    const s = pieceStats.get(p.id)!;
    return {
      piece_id: p.id,
      player_slot: p.player_slot,
      rank: p.rank,
      moves_made: s.moves_made,
      kills: s.kills,
      distance: s.distance,
      first_move: s.first_move,
      death_move: s.death_move,
      alive: p.alive,
    };
  });

  const mvpCandidate = [...pieceCareers].sort((a, b) => b.kills - a.kills)[0] ?? null;
  const turningPoint = findTurningPoint(curveP1, combatMoves);

  const story: Record<string, unknown> = {
    turning_point: turningPoint,
    mvp:
      mvpCandidate && mvpCandidate.kills > 0
        ? {
            piece_id: mvpCandidate.piece_id,
            player_slot: mvpCandidate.player_slot,
            rank: mvpCandidate.rank,
            kills: mvpCandidate.kills,
          }
        : null,
    piece_careers: pieceCareers,
    kill_chains: {
      slot1: {
        length: killChains[1].best,
        start_move: killChains[1].bestStart,
        end_move: killChains[1].bestEnd,
      },
      slot2: {
        length: killChains[2].best,
        start_move: killChains[2].bestStart,
        end_move: killChains[2].bestEnd,
      },
    },
    first_casualty: firstCasualty,
    flag_proximity: { slot1: flagProximity[1], slot2: flagProximity[2] },
    territory_timeline: territoryTimeline,
    think_times: thinkTimes,
    info_edge_curve: infoEdgeBySlot,
    // phase_stats filled after per-slot loop (Task 3–4)
  };

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

    // === INFORMATION WARFARE PASS (ledgers + Big 6 + memory) ===
    const iw = runInformationWarfarePass(
      slot,
      moves as MoveLike[],
      pieces as PieceLike[],
      pieceByIdIw,
      totalMoves,
    );

    infoEdgeBySlot[slot === 1 ? "slot1" : "slot2"] = iw.infoEdgeCurve;

    const revealAttacks = iw.revealAttacks;
    const revealWins = iw.revealWins;
    const revealThenKill = iw.revealThenKill;
    const revealTotal = iw.revealTotal;
    const avengeKills = iw.avengeKills;
    const avengeOpportunities = iw.avengeOpportunities;
    const scoutDistance = iw.scoutDistance;
    const spyFirstCombatMove = iw.spyFirstCombatMove;

    memoryEventsBySlot[slot] = iw.memory.events;
    const memoryWeightTotal = iw.memory.hitsW + iw.memory.missesW;
    memoryScoresBySlot[slot === 1 ? "slot1" : "slot2"] =
      memoryWeightTotal > 0 ? iw.memory.hitsW / memoryWeightTotal : null;

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

    // === PHASE-BINNED STATS (per-slot) ===
    // INVARIANT 1: total captures = attack kills + defense kills
    let totalSlotCaptures = 0;
    for (const m of moves as Move[]) {
      if (isCaptureForSlot(m, slot, pieceById)) totalSlotCaptures++;
    }

    const gamePhaseStats = emptyPhaseStats();
    let runningMaterialDiff = 0; // BEFORE current combat (Lens 2)
    let runningCaptures = 0; // captures completed BEFORE current combat (Lens 1)
    const slotKnownEnemy = new Set<string>(); // known BEFORE current combat (Lens 3)
    // Avenge tracking — same semantics as reveal-set replay career counters
    const phaseKilledByEnemy = new Map<string, string[]>();

    for (const m of moves as Move[]) {
      if (m.move_type !== "attack" || !m.outcome) continue;

      const attackerVal = RANK_VALUE[m.attacker_rank ?? ""] ?? 0;
      const defenderVal = RANK_VALUE[m.defender_rank ?? ""] ?? 0;
      const isMyAttack = m.player_slot === slot;
      const isEnemyAttack = m.player_slot !== slot;

      let iAmDefender = false;
      if (isEnemyAttack && m.defender_piece_id) {
        const dp = pieceById.get(m.defender_piece_id);
        iAmDefender = dp?.player_slot === slot;
      }

      if (!isMyAttack && !iAmDefender) continue;

      // ---- BIN FIRST (INVARIANT 2 + 7: pre-combat material / known count) ----
      const q = captureQuarter(runningCaptures, totalSlotCaptures);
      const ms = materialState(runningMaterialDiff);
      const fog = infoState(slotKnownEnemy.size);
      const bins: PhaseBin[] = [
        gamePhaseStats.by_capture_quarter[q],
        gamePhaseStats.by_material_state[ms],
        gamePhaseStats.by_info_state[fog],
      ];

      if (isMyAttack) {
        // INVARIANT 5: attacks / attack_wins only when WE initiated
        const wasUnknown = m.defender_piece_id
          ? !slotKnownEnemy.has(m.defender_piece_id)
          : false;
        let tradeDelta = 0;
        if (m.outcome === "ATTACKER_WINS") tradeDelta = defenderVal;
        else if (m.outcome === "DEFENDER_WINS") tradeDelta = -attackerVal;
        else tradeDelta = -attackerVal; // TIE — match existing trade loop

        for (const b of bins) {
          b.attacks++;
          if (m.outcome === "ATTACKER_WINS") b.attack_wins++;
          if (wasUnknown) {
            b.reveal_attacks++;
            if (m.outcome === "ATTACKER_WINS") b.reveal_wins++;
          }
          b.trade_sum += tradeDelta;
          b.trade_count++;
        }

        // Avenge kill as attacker: kill an enemy that previously killed one of ours
        if (
          m.outcome === "ATTACKER_WINS" &&
          m.defender_piece_id &&
          phaseKilledByEnemy.has(m.defender_piece_id)
        ) {
          for (const b of bins) b.avenge_kills++;
        }
      } else if (iAmDefender) {
        // Defense: trade only — never attacks / attack_wins
        let tradeDelta = 0;
        if (m.outcome === "DEFENDER_WINS") tradeDelta = attackerVal;
        else if (m.outcome === "ATTACKER_WINS") tradeDelta = -defenderVal;
        else tradeDelta = -defenderVal;

        for (const b of bins) {
          b.trade_sum += tradeDelta;
          b.trade_count++;
        }

        // Avenge opportunity: enemy piece kills one of ours
        if (m.outcome === "ATTACKER_WINS" && m.defender_piece_id) {
          if (!phaseKilledByEnemy.has(m.piece_id)) phaseKilledByEnemy.set(m.piece_id, []);
          phaseKilledByEnemy.get(m.piece_id)!.push(m.defender_piece_id);
          for (const b of bins) b.avenge_opportunities++;
        }

        // Avenge kill as defender: our piece kills that marked enemy attacker
        if (m.outcome === "DEFENDER_WINS" && phaseKilledByEnemy.has(m.piece_id)) {
          for (const b of bins) b.avenge_kills++;
        }
      }

      // ---- THEN UPDATE STATE ----
      if (isMyAttack) {
        if (m.outcome === "ATTACKER_WINS") runningMaterialDiff += defenderVal;
        else if (m.outcome === "DEFENDER_WINS") runningMaterialDiff -= attackerVal;
        else {
          runningMaterialDiff -= attackerVal;
          runningMaterialDiff += defenderVal;
        }
      } else if (iAmDefender) {
        if (m.outcome === "ATTACKER_WINS") runningMaterialDiff -= defenderVal;
        else if (m.outcome === "DEFENDER_WINS") runningMaterialDiff += attackerVal;
        else {
          runningMaterialDiff += attackerVal;
          runningMaterialDiff -= defenderVal;
        }
      }

      if (isCaptureForSlot(m, slot, pieceById)) runningCaptures++;

      if (isMyAttack && m.defender_piece_id) {
        slotKnownEnemy.add(m.defender_piece_id);
      } else if (iAmDefender) {
        slotKnownEnemy.add(m.piece_id);
      }
    }

    // Post-hoc: bin IW memory + deduction latency into same phase lenses
    const iwPhaseStats = binPhaseEvents(iw.phaseEvents, iw.myCaptures);
    mergeIwPhaseFields(gamePhaseStats, iwPhaseStats);

    mergePhaseStats(phaseStatsBySlot[slot], gamePhaseStats);

    // === BOARD GEOGRAPHY ===
    let flankLeft = 0;
    let flankRight = 0;
    let lakeCorridor = 0;
    let defenseDepthSum = 0;
    let defenseDepthCount = 0;
    for (const m of playerMoves as Move[]) {
      if (m.to_col <= 4) flankLeft++;
      else flankRight++;
      if (m.to_col === 4 || m.to_col === 5) lakeCorridor++;
      if (m.move_type === "attack") {
        const homeRow = slot === 1 ? 9 : 0;
        defenseDepthSum += Math.abs(m.to_row - homeRow);
        defenseDepthCount++;
      }
    }

    let invasionLaneKey: "left" | "center" | "right" | null = null;
    for (const m of playerMoves as Move[]) {
      if (slot === 1 && m.to_row <= 4) {
        invasionLaneKey = invasionLane(m.to_col);
        break;
      }
      if (slot === 2 && m.to_row >= 5) {
        invasionLaneKey = invasionLane(m.to_col);
        break;
      }
    }

    // === TEMPO & RHYTHM ===
    const myAttackMoves = (playerMoves as Move[]).filter((m) => m.move_type === "attack");
    const combatMoveNumbers = myAttackMoves.map((m) => m.move_number);
    let cadenceSum = 0;
    let cadenceCount = 0;
    for (let i = 1; i < combatMoveNumbers.length; i++) {
      cadenceSum += combatMoveNumbers[i] - combatMoveNumbers[i - 1];
      cadenceCount++;
    }
    const openingSpeed = combatMoveNumbers.length > 0 ? combatMoveNumbers[0] : null;
    const threshold75 = Math.floor(totalMoves * 0.75);
    const endgameEarlyAttacks = myAttackMoves.filter((m) => m.move_number <= threshold75).length;
    const endgameLateAttacks = myAttackMoves.filter((m) => m.move_number > threshold75).length;

    let thinkSumMs = 0;
    let thinkCount = 0;
    for (let i = 1; i < moves.length; i++) {
      const prev = moves[i - 1] as Move;
      const curr = moves[i] as Move;
      if (curr.player_slot !== slot || !prev.created_at || !curr.created_at) continue;
      const diff =
        new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
      if (diff > 0 && diff < 600_000) {
        thinkSumMs += diff;
        thinkCount++;
      }
    }

    const mergedPhaseCareer = mergePhaseCareer(
      stats.phase_career as PhaseStatsStory | null | undefined,
      gamePhaseStats,
    );

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
        scout_self_reveal_events:
          (stats.scout_self_reveal_events ?? 0) + iw.scoutSelfRevealEvents,
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
        flank_left_moves: (stats.flank_left_moves ?? 0) + flankLeft,
        flank_right_moves: (stats.flank_right_moves ?? 0) + flankRight,
        lake_corridor_moves: (stats.lake_corridor_moves ?? 0) + lakeCorridor,
        defense_depth_sum: Number(stats.defense_depth_sum ?? 0) + defenseDepthSum,
        defense_depth_count: (stats.defense_depth_count ?? 0) + defenseDepthCount,
        invasion_lane_left:
          (stats.invasion_lane_left ?? 0) + (invasionLaneKey === "left" ? 1 : 0),
        invasion_lane_center:
          (stats.invasion_lane_center ?? 0) + (invasionLaneKey === "center" ? 1 : 0),
        invasion_lane_right:
          (stats.invasion_lane_right ?? 0) + (invasionLaneKey === "right" ? 1 : 0),
        combat_cadence_sum: (stats.combat_cadence_sum ?? 0) + cadenceSum,
        combat_cadence_count: (stats.combat_cadence_count ?? 0) + cadenceCount,
        opening_speed_sum: (stats.opening_speed_sum ?? 0) + (openingSpeed ?? 0),
        opening_speed_games:
          (stats.opening_speed_games ?? 0) + (openingSpeed !== null ? 1 : 0),
        endgame_accel_early: (stats.endgame_accel_early ?? 0) + endgameEarlyAttacks,
        endgame_accel_late: (stats.endgame_accel_late ?? 0) + endgameLateAttacks,
        think_time_sum_ms: Number(stats.think_time_sum_ms ?? 0) + thinkSumMs,
        think_time_count: (stats.think_time_count ?? 0) + thinkCount,
        phase_career: mergedPhaseCareer,
        stillness_never_moved: stats.stillness_never_moved + iw.stillnessNeverMoved,
        stillness_movable_total: stats.stillness_movable_total + iw.stillnessMovableTotal,
        info_exchange_ratio_sum: Number(stats.info_exchange_ratio_sum ?? 0) + iw.infoExchangeRatio,
        info_exchange_games: (stats.info_exchange_games ?? 0) + 1,
        deduction_latency_sum: (stats.deduction_latency_sum ?? 0) + iw.deductionLatencySum,
        deduction_latency_count: (stats.deduction_latency_count ?? 0) + iw.deductionLatencyCount,
        bluff_bait_events: (stats.bluff_bait_events ?? 0) + iw.bluffBaitEvents,
        bluff_bait_bitten: (stats.bluff_bait_bitten ?? 0) + iw.bluffBaitBitten,
        reveal_half_life_sum: Number(stats.reveal_half_life_sum ?? 0) +
          (iw.revealHalfLife !== null ? iw.revealHalfLife : 0),
        reveal_half_life_games: (stats.reveal_half_life_games ?? 0) +
          (iw.revealHalfLife !== null ? 1 : 0),
        ambush_defenses: (stats.ambush_defenses ?? 0) + iw.ambushDefenses,
        ambush_wins: (stats.ambush_wins ?? 0) + iw.ambushWins,
        controlled_exposure_attacks:
          (stats.controlled_exposure_attacks ?? 0) + iw.controlledExposureAttacks,
        controlled_exposure_burned:
          (stats.controlled_exposure_burned ?? 0) + iw.controlledExposureBurned,
        silent_majority_sum: Number(stats.silent_majority_sum ?? 0) + iw.silentMajority,
        silent_majority_games: (stats.silent_majority_games ?? 0) + 1,
        silent_majority_wins_sum: Number(stats.silent_majority_wins_sum ?? 0) +
          (won ? iw.silentMajority : 0),
        silent_majority_losses_sum: Number(stats.silent_majority_losses_sum ?? 0) +
          (!won && game.winner_slot != null ? iw.silentMajority : 0),
        memory_hits_w: Number(stats.memory_hits_w ?? 0) + iw.memory.hitsW,
        memory_misses_w: Number(stats.memory_misses_w ?? 0) + iw.memory.missesW,
        memory_hits: (stats.memory_hits ?? 0) + iw.memory.hits,
        memory_misses: (stats.memory_misses ?? 0) + iw.memory.misses,
        memory_bomb_hits: (stats.memory_bomb_hits ?? 0) + iw.memory.bombHits,
        memory_bomb_misses: (stats.memory_bomb_misses ?? 0) + iw.memory.bombMisses,
        memory_track_hits: (stats.memory_track_hits ?? 0) + iw.memory.trackHits,
        memory_track_misses: (stats.memory_track_misses ?? 0) + iw.memory.trackMisses,
        memory_scouting: mergeMemoryScoutingWithCareer(
          stats.memory_scouting,
          iw.memory,
          Number(stats.memory_hits_w ?? 0) + iw.memory.hitsW,
          Number(stats.memory_misses_w ?? 0) + iw.memory.missesW,
          (stats.memory_hits ?? 0) + iw.memory.hits,
          (stats.memory_misses ?? 0) + iw.memory.misses,
          (stats.memory_bomb_hits ?? 0) + iw.memory.bombHits,
          (stats.memory_bomb_misses ?? 0) + iw.memory.bombMisses,
          Number((stats.memory_scouting as { marshal_hits?: number })?.marshal_hits ?? 0) +
            iw.memory.marshalHits,
          Number((stats.memory_scouting as { marshal_misses?: number })?.marshal_misses ?? 0) +
            iw.memory.marshalMisses,
          (stats.memory_track_hits ?? 0) + iw.memory.trackHits,
          (stats.memory_track_misses ?? 0) + iw.memory.trackMisses,
          game.is_bot_game ?? false,
        ),
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

      const info = computeInfoArchetype({
        stillness_never_moved: (stats.stillness_never_moved ?? 0) + iw.stillnessNeverMoved,
        stillness_movable_total: (stats.stillness_movable_total ?? 0) + iw.stillnessMovableTotal,
        info_exchange_ratio_sum: Number(stats.info_exchange_ratio_sum ?? 0) + iw.infoExchangeRatio,
        info_exchange_games: (stats.info_exchange_games ?? 0) + 1,
        deduction_latency_sum: (stats.deduction_latency_sum ?? 0) + iw.deductionLatencySum,
        deduction_latency_count: (stats.deduction_latency_count ?? 0) + iw.deductionLatencyCount,
        bluff_bait_events: (stats.bluff_bait_events ?? 0) + iw.bluffBaitEvents,
        bluff_bait_bitten: (stats.bluff_bait_bitten ?? 0) + iw.bluffBaitBitten,
        reveal_half_life_sum: Number(stats.reveal_half_life_sum ?? 0) +
          (iw.revealHalfLife !== null ? iw.revealHalfLife : 0),
        reveal_half_life_games: (stats.reveal_half_life_games ?? 0) +
          (iw.revealHalfLife !== null ? 1 : 0),
        ambush_defenses: (stats.ambush_defenses ?? 0) + iw.ambushDefenses,
        ambush_wins: (stats.ambush_wins ?? 0) + iw.ambushWins,
        controlled_exposure_attacks:
          (stats.controlled_exposure_attacks ?? 0) + iw.controlledExposureAttacks,
        controlled_exposure_burned:
          (stats.controlled_exposure_burned ?? 0) + iw.controlledExposureBurned,
        silent_majority_sum: Number(stats.silent_majority_sum ?? 0) + iw.silentMajority,
        silent_majority_games: (stats.silent_majority_games ?? 0) + 1,
        memory_hits_w: Number(stats.memory_hits_w ?? 0) + iw.memory.hitsW,
        memory_misses_w: Number(stats.memory_misses_w ?? 0) + iw.memory.missesW,
      });

      const { error: archetypeUpdateError } = await supabase
        .from("player_stats")
        .update({
          archetype,
          archetype_updated_at: new Date().toISOString(),
          info_archetype: info.archetype,
          info_archetype_updated_at: new Date().toISOString(),
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

  story.phase_stats = {
    slot1: phaseStatsBySlot[1],
    slot2: phaseStatsBySlot[2],
  };
  story.memory_moments = {
    slot1: topMemoryMoments(memoryEventsBySlot[1], 5),
    slot2: topMemoryMoments(memoryEventsBySlot[2], 5),
  };
  story.memory_scores = memoryScoresBySlot;

  await supabase.from("game_summaries").upsert(
    {
      game_id,
      material_curve_p1: curveP1,
      material_curve_p2: curveP2,
      story,
    },
    { onConflict: "game_id" },
  );

  await supabase.from("games").update({ stats_computed: true }).eq("id", game_id);

  return jsonResponse({ ok: true });
});
