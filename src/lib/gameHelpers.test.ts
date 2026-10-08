import { describe, expect, it } from 'vitest';
import type { FogPiece, GameRow, MoveRow } from '../types.ts';
import {
  getPostCombatRevealRank,
  inferEnemyDeadRanks,
  shouldApplyGameRow,
  toAbsolute,
  toDisplay,
} from './gameHelpers.ts';

function gameRow(overrides: Partial<GameRow> = {}): GameRow {
  return {
    status: 'active',
    current_turn_slot: 1,
    turn_number: 1,
    winner_slot: null,
    is_bot_game: false,
    bot_difficulty: null,
    bot_personality: null,
    rematch_room_code: null,
    ...overrides,
  };
}

function piece(overrides: Partial<FogPiece> & Pick<FogPiece, 'piece_id'>): FogPiece {
  return {
    player_slot: 2,
    rank: null,
    row_idx: 0,
    col_idx: 0,
    alive: true,
    is_mine: false,
    ...overrides,
  };
}

function attack(overrides: Partial<MoveRow> & Pick<MoveRow, 'move_number' | 'piece_id'>): MoveRow {
  return {
    player_slot: 1,
    from_row: 6,
    from_col: 0,
    to_row: 5,
    to_col: 0,
    move_type: 'attack',
    outcome: 'ATTACKER_WINS',
    attacker_rank: '5',
    defender_rank: '8',
    ...overrides,
  };
}

describe('toAbsolute and toDisplay', () => {
  it('leaves slot 1 and spectator slot 0 in absolute coordinates', () => {
    expect(toAbsolute(0, 0, 1)).toEqual({ row: 0, col: 0 });
    expect(toAbsolute(3, 9, 1)).toEqual({ row: 3, col: 9 });
    expect(toAbsolute(4, 2, 0)).toEqual({ row: 4, col: 2 });
    expect(toDisplay(4, 2, 0)).toEqual({ row: 4, col: 2 });
    expect(toDisplay(3, 9, 1)).toEqual({ row: 3, col: 9 });
  });

  it('rotates slot 2 by 180 degrees', () => {
    expect(toAbsolute(0, 0, 2)).toEqual({ row: 9, col: 9 });
    expect(toAbsolute(1, 2, 2)).toEqual({ row: 8, col: 7 });
    expect(toDisplay(9, 9, 2)).toEqual({ row: 0, col: 0 });
    expect(toDisplay(8, 7, 2)).toEqual({ row: 1, col: 2 });
  });

  it('round-trips every square for both seats', () => {
    for (const slot of [1, 2] as const) {
      for (let row = 0; row < 10; row += 1) {
        for (let col = 0; col < 10; col += 1) {
          const absolute = toAbsolute(row, col, slot);
          expect(toDisplay(absolute.row, absolute.col, slot)).toEqual({ row, col });
          const displayed = toDisplay(row, col, slot);
          expect(toAbsolute(displayed.row, displayed.col, slot)).toEqual({ row, col });
        }
      }
    }
  });
});

describe('shouldApplyGameRow', () => {
  it('accepts the first row', () => {
    expect(shouldApplyGameRow(gameRow(), null)).toBe(true);
  });

  it('accepts a strictly newer turn and rejects an older one', () => {
    const prev = gameRow({ turn_number: 4, status: 'finished' });
    expect(shouldApplyGameRow(gameRow({ turn_number: 5, status: 'setup' }), prev)).toBe(true);
    expect(shouldApplyGameRow(gameRow({ turn_number: 3, status: 'finished' }), prev)).toBe(false);
  });

  it('accepts a resign on the same turn number', () => {
    const prev = gameRow({ turn_number: 7, status: 'active' });
    const resigned = gameRow({ turn_number: 7, status: 'finished', winner_slot: 2 });
    expect(shouldApplyGameRow(resigned, prev)).toBe(true);
  });

  it('accepts setup to active and rejects a status regression on the same turn', () => {
    const setup = gameRow({ turn_number: 0, status: 'setup' });
    const active = gameRow({ turn_number: 0, status: 'active' });
    const finished = gameRow({ turn_number: 2, status: 'finished', winner_slot: 1 });
    expect(shouldApplyGameRow(active, setup)).toBe(true);
    expect(shouldApplyGameRow(setup, active)).toBe(false);
    expect(shouldApplyGameRow(gameRow({ turn_number: 2, status: 'active' }), finished)).toBe(false);
  });

  it('accepts the same turn and status so a rematch code can land', () => {
    const prev = gameRow({ turn_number: 4, status: 'finished', winner_slot: 1 });
    const next = gameRow({
      turn_number: 4,
      status: 'finished',
      winner_slot: 1,
      rematch_room_code: 'NEWROOM',
    });
    expect(shouldApplyGameRow(next, prev)).toBe(true);
  });

  it('treats an unknown status as older than every known status', () => {
    const prev = gameRow({ turn_number: 1, status: 'setup' });
    const unknown = gameRow({ turn_number: 1, status: 'archived' as GameRow['status'] });
    expect(shouldApplyGameRow(unknown, prev)).toBe(false);
    expect(shouldApplyGameRow(unknown, gameRow({ turn_number: 1, status: 'archived' as GameRow['status'] }))).toBe(true);
  });
});

describe('inferEnemyDeadRanks', () => {
  const miner = piece({
    piece_id: 'enemy-miner',
    player_slot: 2,
    alive: false,
    is_mine: false,
    row_idx: 5,
    col_idx: 0,
  });
  const myCaptain = piece({
    piece_id: 'my-captain',
    player_slot: 1,
    alive: true,
    is_mine: true,
    row_idx: 5,
    col_idx: 0,
    rank: '5',
  });

  it('returns an empty map when there are no attacks', () => {
    expect(inferEnemyDeadRanks([miner], [])).toEqual(new Map());
    expect(
      inferEnemyDeadRanks(
        [miner, myCaptain],
        [attack({ move_number: 1, piece_id: 'my-captain', move_type: 'move', outcome: null })],
      ),
    ).toEqual(new Map());
  });

  it('records the defender rank when my attack wins', () => {
    const ranks = inferEnemyDeadRanks(
      [miner, myCaptain],
      [attack({ move_number: 1, piece_id: 'my-captain', outcome: 'ATTACKER_WINS', defender_rank: '8' })],
    );
    expect(ranks).toEqual(new Map([['enemy-miner', '8']]));
  });

  it('records the attacker rank when an enemy attack loses or ties', () => {
    const enemyScout = piece({
      piece_id: 'enemy-scout',
      alive: false,
      is_mine: false,
      row_idx: 4,
      col_idx: 1,
    });
    const myBomb = piece({
      piece_id: 'my-bomb',
      player_slot: 1,
      alive: true,
      is_mine: true,
      rank: 'BOMB',
      row_idx: 6,
      col_idx: 1,
    });

    const defended = inferEnemyDeadRanks(
      [enemyScout, myBomb],
      [
        attack({
          move_number: 2,
          piece_id: 'enemy-scout',
          player_slot: 2,
          outcome: 'DEFENDER_WINS',
          attacker_rank: '9',
          defender_rank: 'BOMB',
          to_row: 6,
          to_col: 1,
        }),
      ],
    );
    expect(defended.get('enemy-scout')).toBe('9');

    const tied = inferEnemyDeadRanks(
      [enemyScout],
      [
        attack({
          move_number: 3,
          piece_id: 'enemy-scout',
          outcome: 'TIE',
          attacker_rank: '6',
          defender_rank: '6',
        }),
      ],
    );
    expect(tied.get('enemy-scout')).toBe('6');
  });

  it('records the enemy defender on my tie and ignores my own losses', () => {
    const deadEnemy = piece({
      piece_id: 'enemy-sergeant',
      alive: false,
      is_mine: false,
      row_idx: 5,
      col_idx: 0,
    });
    const tied = inferEnemyDeadRanks(
      [deadEnemy, myCaptain],
      [attack({ move_number: 1, piece_id: 'my-captain', outcome: 'TIE', defender_rank: '7' })],
    );
    expect(tied.get('enemy-sergeant')).toBe('7');

    const myDead = piece({
      piece_id: 'my-captain',
      player_slot: 1,
      alive: false,
      is_mine: true,
      rank: '5',
    });
    const lost = inferEnemyDeadRanks(
      [myDead, piece({ piece_id: 'enemy-live', alive: true, is_mine: false, row_idx: 5, col_idx: 0 })],
      [attack({ move_number: 1, piece_id: 'my-captain', outcome: 'DEFENDER_WINS', attacker_rank: '5' })],
    );
    expect(lost.size).toBe(0);
  });

  it('keeps the first inferred rank for a piece', () => {
    const ranks = inferEnemyDeadRanks(
      [miner, myCaptain],
      [
        attack({ move_number: 1, piece_id: 'my-captain', defender_rank: '8' }),
        attack({ move_number: 2, piece_id: 'my-captain', defender_rank: 'BOMB' }),
      ],
    );
    expect(ranks.get('enemy-miner')).toBe('8');
  });

  it('skips a winning attack when the dead defender is not on the destination', () => {
    const elsewhere = piece({ ...miner, row_idx: 0, col_idx: 9 });
    const ranks = inferEnemyDeadRanks(
      [elsewhere, myCaptain],
      [attack({ move_number: 1, piece_id: 'my-captain', outcome: 'ATTACKER_WINS' })],
    );
    expect(ranks.size).toBe(0);
  });

  it('does not infer a rank for an enemy attack that captured my piece', () => {
    const enemyAlive = piece({ piece_id: 'enemy-marshal', alive: true, is_mine: false, row_idx: 5, col_idx: 0 });
    const ranks = inferEnemyDeadRanks(
      [enemyAlive, piece({ piece_id: 'my-dead', player_slot: 1, alive: false, is_mine: true, rank: '8' })],
      [
        attack({
          move_number: 1,
          piece_id: 'enemy-marshal',
          outcome: 'ATTACKER_WINS',
          attacker_rank: '1',
          defender_rank: '8',
        }),
      ],
    );
    expect(ranks.size).toBe(0);
  });
});

describe('getPostCombatRevealRank', () => {
  function piecesOf(...rows: FogPiece[]): Map<string, FogPiece> {
    return new Map(rows.map((row) => [row.piece_id, row]));
  }

  it('returns null without an attack, on a tie, or for a quiet move', () => {
    const enemy = piece({ piece_id: 'enemy', alive: true, is_mine: false });
    const pieces = piecesOf(enemy);
    expect(getPostCombatRevealRank('enemy', null, pieces, false)).toBeNull();
    expect(
      getPostCombatRevealRank('enemy', attack({ move_number: 1, piece_id: 'enemy', outcome: 'TIE' }), pieces, false),
    ).toBeNull();
    expect(
      getPostCombatRevealRank(
        'enemy',
        attack({ move_number: 1, piece_id: 'enemy', move_type: 'move', outcome: null }),
        pieces,
        false,
      ),
    ).toBeNull();
  });

  it('reveals a living enemy attacker for one move after they win', () => {
    const enemy = piece({ piece_id: 'enemy', alive: true, is_mine: false, player_slot: 2 });
    const last = attack({ move_number: 4, piece_id: 'enemy', outcome: 'ATTACKER_WINS', attacker_rank: '9' });
    expect(getPostCombatRevealRank('enemy', last, piecesOf(enemy), false)).toBe('9');
    expect(getPostCombatRevealRank('someone-else', last, piecesOf(enemy), false)).toBeNull();
  });

  it('does not reveal my attacker or a dead attacker', () => {
    const mine = piece({ piece_id: 'mine', alive: true, is_mine: true, player_slot: 1, rank: '5' });
    const dead = piece({ piece_id: 'dead-enemy', alive: false, is_mine: false });
    const won = attack({ move_number: 1, piece_id: 'mine', outcome: 'ATTACKER_WINS', attacker_rank: '5' });
    expect(getPostCombatRevealRank('mine', won, piecesOf(mine), false)).toBeNull();
    const enemyWon = attack({ move_number: 2, piece_id: 'dead-enemy', outcome: 'ATTACKER_WINS', attacker_rank: '3' });
    expect(getPostCombatRevealRank('dead-enemy', enemyWon, piecesOf(dead), false)).toBeNull();
  });

  it('reveals a living enemy defender standing on the capture square', () => {
    const defender = piece({
      piece_id: 'enemy-bomb',
      alive: true,
      is_mine: false,
      player_slot: 2,
      row_idx: 5,
      col_idx: 0,
    });
    const last = attack({
      move_number: 6,
      piece_id: 'my-miner',
      outcome: 'DEFENDER_WINS',
      defender_rank: 'BOMB',
      to_row: 5,
      to_col: 0,
    });
    expect(getPostCombatRevealRank('enemy-bomb', last, piecesOf(defender), false)).toBe('BOMB');
    expect(getPostCombatRevealRank('missing', last, piecesOf(defender), false)).toBeNull();
  });

  it('does not reveal my own defender', () => {
    const defender = piece({
      piece_id: 'my-bomb',
      alive: true,
      is_mine: true,
      player_slot: 1,
      rank: 'BOMB',
      row_idx: 6,
      col_idx: 2,
    });
    const last = attack({
      move_number: 2,
      piece_id: 'enemy',
      outcome: 'DEFENDER_WINS',
      defender_rank: 'BOMB',
      to_row: 6,
      to_col: 2,
    });
    expect(getPostCombatRevealRank('my-bomb', last, piecesOf(defender), false)).toBeNull();
  });

  it('treats slot 2 as the enemy when spectating', () => {
    const slot2 = piece({ piece_id: 'p2', alive: true, is_mine: false, player_slot: 2, row_idx: 1, col_idx: 1 });
    const slot1 = piece({
      piece_id: 'p1',
      alive: true,
      is_mine: false,
      player_slot: 1,
      rank: '1',
      row_idx: 8,
      col_idx: 1,
    });
    const attackerWon = attack({ move_number: 1, piece_id: 'p2', outcome: 'ATTACKER_WINS', attacker_rank: '4' });
    expect(getPostCombatRevealRank('p2', attackerWon, piecesOf(slot2), true)).toBe('4');
    const slot1Won = attack({ move_number: 2, piece_id: 'p1', outcome: 'ATTACKER_WINS', attacker_rank: '1' });
    expect(getPostCombatRevealRank('p1', slot1Won, piecesOf(slot1), true)).toBeNull();

    const defenderWon = attack({
      move_number: 3,
      piece_id: 'p1',
      outcome: 'DEFENDER_WINS',
      defender_rank: 'FLAG',
      to_row: 1,
      to_col: 1,
    });
    expect(getPostCombatRevealRank('p2', defenderWon, piecesOf(slot2, slot1), true)).toBe('FLAG');
    const slot1Defends = attack({
      move_number: 4,
      piece_id: 'p2',
      outcome: 'DEFENDER_WINS',
      defender_rank: '1',
      to_row: 8,
      to_col: 1,
    });
    expect(getPostCombatRevealRank('p1', slot1Defends, piecesOf(slot2, slot1), true)).toBeNull();
  });
});
