// Shared types for the rules engine, bot, and UI.
// Postgres stores ranks as text. Rules code uses Rank (numbers 1..10, plus "BOMB" and "FLAG").
// Convert at the RPC boundary with normalizeRank.

export type NumericRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type Rank = NumericRank | 'BOMB' | 'FLAG';
export type Slot = 1 | 2;

export interface Square {
  row: number;
  col: number;
}

/** `"row,col"` string used by two-square history. Not a Square. */
export type SquareKey = string;

export type GameStatus = 'setup' | 'active' | 'finished';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Personality = 'aggressive' | 'neutral' | 'defensive';
export type CombatOutcome = 'ATTACKER_WINS' | 'DEFENDER_WINS' | 'TIE';

export interface RulesPiece {
  id: string;
  playerSlot: Slot;
  rank: Rank;
  row: number;
  col: number;
  alive: boolean;
}

export interface FogPiece {
  piece_id: string;
  player_slot: Slot;
  rank: string | null;
  row_idx: number;
  col_idx: number;
  alive: boolean;
  is_mine: boolean;
}

export interface GameRow {
  id?: string;
  status: GameStatus;
  current_turn_slot: Slot | null;
  turn_number: number;
  winner_slot: Slot | null;
  is_bot_game: boolean;
  bot_difficulty: Difficulty | null;
  bot_personality: Personality | null;
  rematch_room_code: string | null;
  /** Realtime payload only; not in the games select lists. */
  both_submitted_at?: string | null;
}

export interface HistoryEntry {
  pieceId: string;
  from: SquareKey;
  to: SquareKey;
}

export interface GameState {
  status: GameStatus;
  currentTurnSlot: Slot;
  pieces: RulesPiece[];
  moveHistoryByPlayer: Partial<Record<Slot, HistoryEntry[]>>;
}

/** Move-log row (games UI). Ranks stay text, as Postgres returns them. */
export interface MoveRow {
  move_number: number;
  player_slot: Slot;
  piece_id: string;
  from_row: number;
  from_col: number;
  to_row: number;
  to_col: number;
  move_type: 'move' | 'attack';
  outcome: CombatOutcome | null;
  attacker_rank: string | null;
  defender_rank: string | null;
}

/** Moves-table subset the bot reads. Includes defender_piece_id; outcome null means a non-combat move. */
export interface BotMoveRow {
  move_number: number;
  piece_id: string;
  player_slot: Slot;
  from_row: number;
  from_col: number;
  to_row: number;
  to_col: number;
  outcome: CombatOutcome | null;
  attacker_rank: string | null;
  defender_rank: string | null;
  defender_piece_id: string | null;
}

export interface ChatMessage {
  player_slot: Slot;
  body: string;
  created_at: string;
}

export type CombatResult = {
  outcome: CombatOutcome;
  attackerRank: Rank | string;
  defenderRank: Rank | string;
  defenderPieceId: string;
} | null;

/** Local setup coordinates. Rank is the wire form: "1".."10" | "BOMB" | "FLAG". */
export type FormationCell = [localRow: number, localCol: number, rank: string];

export interface Formation {
  name: string;
  cells: FormationCell[];
}

// Rank labels. Object keys are strings, so RANK_NAME[1] and RANK_NAME["1"] are the same lookup.
// Canonical copies of the maps previously inlined in token.js, game.js, profile.js, and gameDetail.js.
// Those page scripts keep local copies until they move onto this module.

export const RANK_NAME: Record<string | number, string> = {
  '1': 'Marshal',
  '2': 'General',
  '3': 'Colonel',
  '4': 'Major',
  '5': 'Captain',
  '6': 'Lieutenant',
  '7': 'Sergeant',
  '8': 'Miner',
  '9': 'Scout',
  '10': 'Spy',
  BOMB: 'Bomb',
  FLAG: 'Flag',
};

/** Two-letter labels (game.js RANK_SHORT, graveyard chips). */
export const RANK_SHORT: Record<string | number, string> = {
  '1': 'Ma',
  '2': 'Ge',
  '3': 'Co',
  '4': 'Mj',
  '5': 'Cp',
  '6': 'Lt',
  '7': 'Sg',
  '8': 'Mi',
  '9': 'Sc',
  '10': 'Sp',
  BOMB: 'B',
  FLAG: 'F',
};

/** On-token glyphs (token.js center labels). */
export const RANK_ABBR: Record<string | number, string> = {
  '1': '10',
  '2': '9',
  '3': '8',
  '4': '7',
  '5': '6',
  '6': '5',
  '7': '4',
  '8': '3',
  '9': '2',
  '10': 'S',
  BOMB: '💣',
  FLAG: '🚩',
};

/** Piece-fate chart labels. FLAG is omitted so flag keys stay filtered out. */
export const RANK_DISPLAY: Record<string | number, string> = {
  '1': 'Marshal',
  '2': 'General',
  '3': 'Colonel',
  '4': 'Major',
  '5': 'Captain',
  '6': 'Lieutenant',
  '7': 'Sergeant',
  '8': 'Miner',
  '9': 'Scout',
  '10': 'Spy',
  BOMB: 'Bomb',
};

export function rankLabel(rank: string | number | null | undefined): string {
  if (rank == null) return '';
  return RANK_NAME[rank] ?? String(rank);
}

export function rankAbbr(rank: string | number | null | undefined): string {
  if (rank == null) return '';
  return RANK_SHORT[rank] ?? String(rank);
}
