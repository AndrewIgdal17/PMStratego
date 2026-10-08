/**
 * @vitest-environment jsdom
 */
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseBotMove } from '../bot/bot.ts';
import { callFunction } from '../lib/supabaseClient.ts';
import type { FogPiece, GameRow, MoveRow } from '../types.ts';
import { useGameState } from './useGameState.ts';

const mocks = vi.hoisted(() => {
  const handlers: {
    game: ((payload: { new: Record<string, unknown> }) => void) | null;
    chat: (() => void) | null;
  } = { game: null, chat: null };

  const state = {
    gameId: { data: { id: 'game-1' } as { id: string } | null, error: null as { message: string } | null },
    liveRow: null as GameRow | null,
    pollRow: null as GameRow | null,
    pieces: [] as FogPiece[],
    spectatorPieces: [] as FogPiece[],
    moves: [] as MoveRow[],
    botMoves: [] as MoveRow[],
    chat: [] as Array<{ player_slot: 1 | 2; body: string; created_at: string }>,
    rpcError: null as { message: string } | null,
    rowQueue: [] as Array<{ row: GameRow; wait: Promise<void> }>,
    counts: { fullRow: 0, poll: 0, playerRpc: 0, spectatorRpc: 0, botRpc: 0 },
  };

  const removeChannel = vi.fn(async () => 'ok');
  const channel = vi.fn((name: string) => {
    const api = {
      name,
      on: vi.fn(
        (
          _event: string,
          filter: { table?: string },
          cb: (payload: { new: Record<string, unknown> }) => void,
        ) => {
          if (filter.table === 'games') handlers.game = cb;
          if (filter.table === 'chat_messages') handlers.chat = () => cb({ new: {} });
          return api;
        },
      ),
      subscribe: vi.fn(() => api),
    };
    return api;
  });

  return { handlers, state, removeChannel, channel };
});

vi.mock('../lib/supabaseClient.ts', () => ({
  callFunction: vi.fn(),
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: () => ({
          single: async () => {
            if (table === 'games' && columns === 'id') {
              if (mocks.state.gameId.error || !mocks.state.gameId.data?.id) {
                return { data: null, error: mocks.state.gameId.error ?? { message: 'missing' } };
              }
              return { data: mocks.state.gameId.data, error: null };
            }
            if (table === 'games' && columns.includes('is_bot_game')) {
              mocks.state.counts.fullRow += 1;
              const queued = mocks.state.rowQueue.shift();
              if (queued) {
                await queued.wait;
                return { data: queued.row, error: null };
              }
              if (!mocks.state.liveRow) return { data: null, error: { message: 'missing row' } };
              return { data: mocks.state.liveRow, error: null };
            }
            if (table === 'games') {
              mocks.state.counts.poll += 1;
              return { data: mocks.state.pollRow ?? mocks.state.liveRow, error: null };
            }
            return { data: null, error: { message: `unexpected ${table}` } };
          },
          order: async () => {
            if (table === 'moves' && columns.includes('defender_piece_id')) {
              return { data: mocks.state.botMoves, error: null };
            }
            if (table === 'moves') return { data: mocks.state.moves, error: null };
            if (table === 'chat_messages') return { data: mocks.state.chat, error: null };
            return { data: null, error: { message: `unexpected ${table}` } };
          },
        }),
      }),
    }),
    rpc: async (name: string, args: { p_token?: string }) => {
      if (name === 'get_spectator_state') {
        mocks.state.counts.spectatorRpc += 1;
        return { data: mocks.state.spectatorPieces, error: mocks.state.rpcError };
      }
      mocks.state.counts.playerRpc += 1;
      if (args.p_token === 'bot-secret') mocks.state.counts.botRpc += 1;
      return { data: mocks.state.pieces, error: mocks.state.rpcError };
    },
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));

vi.mock('../bot/bot.ts', () => ({
  chooseBotMove: vi.fn(() => ({
    pieceId: 'bot-piece',
    from: { row: 0, col: 0 },
    to: { row: 1, col: 0 },
  })),
}));

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

function seat(slot: '1' | '2' = '1'): void {
  localStorage.setItem('stratego:ROOM:token', 'seat-token');
  localStorage.setItem('stratego:ROOM:slot', slot);
}

async function drain(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function showPage(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await drain();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mocks.handlers.game = null;
  mocks.handlers.chat = null;
  mocks.state.gameId = { data: { id: 'game-1' }, error: null };
  mocks.state.liveRow = gameRow();
  mocks.state.pollRow = null;
  mocks.state.pieces = [
    {
      piece_id: 'mine',
      player_slot: 1,
      rank: '5',
      row_idx: 6,
      col_idx: 0,
      alive: true,
      is_mine: true,
    },
  ];
  mocks.state.spectatorPieces = [];
  mocks.state.moves = [];
  mocks.state.botMoves = [];
  mocks.state.chat = [];
  mocks.state.rpcError = null;
  mocks.state.rowQueue = [];
  mocks.state.counts = { fullRow: 0, poll: 0, playerRpc: 0, spectatorRpc: 0, botRpc: 0 };
  mocks.removeChannel.mockClear();
  mocks.channel.mockClear();
  vi.mocked(callFunction).mockReset();
  vi.mocked(chooseBotMove).mockReset();
  vi.mocked(chooseBotMove).mockReturnValue({
    pieceId: 'bot-piece',
    from: { row: 0, col: 0 },
    to: { row: 1, col: 0 },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useGameState load', () => {
  it('loads fog, the game row, moves, and chat for the seated player', async () => {
    seat('2');
    mocks.state.liveRow = gameRow({ turn_number: 3, current_turn_slot: 2 });
    mocks.state.moves = [
      {
        move_number: 1,
        player_slot: 2,
        piece_id: 'mine',
        from_row: 6,
        from_col: 0,
        to_row: 5,
        to_col: 0,
        move_type: 'move',
        outcome: null,
        attacker_rank: null,
        defender_rank: null,
      },
    ];
    mocks.state.chat = [{ player_slot: 1, body: 'hi', created_at: 't0' }];

    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.mySlot).toBe(2);
    expect(result.current.gameRow?.turn_number).toBe(3);
    expect(result.current.pieces.get('mine')?.rank).toBe('5');
    expect(result.current.moves).toHaveLength(1);
    expect(result.current.chat[0]?.body).toBe('hi');
    expect(mocks.state.counts.playerRpc).toBeGreaterThan(0);
    expect(mocks.state.counts.spectatorRpc).toBe(0);
    expect(mocks.channel).toHaveBeenCalledWith('game-game-1');
  });

  it('stops when the seat token is missing', async () => {
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(/token/i);
    expect(mocks.state.counts.playerRpc).toBe(0);
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it('reports a missing game', async () => {
    seat();
    mocks.state.gameId = { data: null, error: { message: 'no rows' } };
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatch(/not found/i);
  });

  it('loads spectator fog and does not poll', async () => {
    mocks.state.spectatorPieces = [
      {
        piece_id: 'flag',
        player_slot: 1,
        rank: 'FLAG',
        row_idx: 9,
        col_idx: 0,
        alive: true,
        is_mine: false,
      },
    ];
    const { result } = renderHook(() => useGameState('ROOM', true));
    await drain();
    const polls = mocks.state.counts.poll;
    expect(result.current.mySlot).toBe(0);
    expect(result.current.pieces.get('flag')?.rank).toBe('FLAG');
    expect(mocks.state.counts.spectatorRpc).toBeGreaterThan(0);
    expect(mocks.state.counts.playerRpc).toBe(0);
    expect(mocks.channel).toHaveBeenCalledWith('game-game-1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await drain();
    expect(mocks.state.counts.poll).toBe(polls);
  });
});

describe('useGameState monotonic row', () => {
  it('drops an older turn that arrives after a newer one', async () => {
    seat();
    mocks.state.liveRow = gameRow({ turn_number: 5, status: 'active' });
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    mocks.state.liveRow = gameRow({ turn_number: 4, status: 'finished', winner_slot: 1 });
    await showPage();
    expect(result.current.gameRow?.turn_number).toBe(5);
    expect(result.current.gameRow?.status).toBe('active');
  });

  it('applies a resign on the same turn number', async () => {
    seat();
    mocks.state.liveRow = gameRow({ turn_number: 7, status: 'active' });
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    mocks.state.liveRow = gameRow({ turn_number: 7, status: 'finished', winner_slot: 2 });
    await showPage();
    expect(result.current.gameRow?.status).toBe('finished');
    expect(result.current.gameRow?.winner_slot).toBe(2);
  });

  it('rejects a status regression on the same turn', async () => {
    seat();
    mocks.state.liveRow = gameRow({ turn_number: 2, status: 'finished', winner_slot: 1 });
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    mocks.state.liveRow = gameRow({ turn_number: 2, status: 'active' });
    await showPage();
    expect(result.current.gameRow?.status).toBe('finished');
  });

  it('keeps the newer row when an older fetch resolves last', async () => {
    seat();
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    mocks.state.rowQueue = [
      { row: gameRow({ turn_number: 2 }), wait: Promise.resolve() },
      { row: gameRow({ turn_number: 1 }), wait: slow },
      { row: gameRow({ turn_number: 4 }), wait: Promise.resolve() },
    ];

    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();
    expect(result.current.gameRow?.turn_number).toBe(2);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await drain();
    expect(result.current.gameRow?.turn_number).toBe(4);

    releaseSlow();
    await drain();
    expect(result.current.gameRow?.turn_number).toBe(4);
  });

  it('still applies a slow newer row after a faster older fetch', async () => {
    seat();
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    mocks.state.rowQueue = [
      { row: gameRow({ turn_number: 2 }), wait: Promise.resolve() },
      { row: gameRow({ turn_number: 5 }), wait: slow },
      { row: gameRow({ turn_number: 3 }), wait: Promise.resolve() },
    ];

    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();
    expect(result.current.gameRow?.turn_number).toBe(2);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await drain();
    expect(result.current.gameRow?.turn_number).toBe(3);

    releaseSlow();
    await drain();
    expect(result.current.gameRow?.turn_number).toBe(5);
  });
});

describe('useGameState rematch', () => {
  it('opens the rematch code from a realtime payload', async () => {
    seat();
    mocks.state.liveRow = gameRow({ status: 'finished', turn_number: 3, winner_slot: 1 });
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    await act(async () => {
      mocks.handlers.game?.({ new: { rematch_room_code: 'NEXT', status: 'finished' } });
    });
    await drain();
    expect(result.current.rematchCode).toBe('NEXT');

    act(() => {
      result.current.dismissRematch();
    });
    expect(result.current.rematchCode).toBeNull();
  });

  it('does not open a rematch for a spectator', async () => {
    mocks.state.liveRow = gameRow({ status: 'finished', turn_number: 3, winner_slot: 1 });
    const { result } = renderHook(() => useGameState('ROOM', true));
    await drain();
    await act(async () => {
      mocks.handlers.game?.({ new: { rematch_room_code: 'NEXT', status: 'finished' } });
    });
    await drain();
    expect(result.current.rematchCode).toBeNull();
  });

  it('notices a rematch code on the poll when the turn and status are unchanged', async () => {
    seat();
    const finished = gameRow({ status: 'finished', turn_number: 2, winner_slot: 1 });
    mocks.state.liveRow = finished;
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    const withCode = { ...finished, rematch_room_code: 'POLLED' };
    mocks.state.liveRow = withCode;
    mocks.state.pollRow = withCode;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await drain();
    expect(result.current.rematchCode).toBe('POLLED');
  });
});

describe('useGameState cleanup', () => {
  it('removes the channel, the poll, and the visibility listener', async () => {
    seat();
    const listeners: EventListener[] = [];
    const originalAdd = document.addEventListener.bind(document);
    const addSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'visibilitychange' && typeof listener === 'function') listeners.push(listener);
      originalAdd(type, listener, options);
    });
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useGameState('ROOM', false));
    await drain();
    const polls = mocks.state.counts.poll;
    expect(listeners.length).toBeGreaterThan(0);

    unmount();
    expect(mocks.removeChannel).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', listeners[listeners.length - 1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.state.counts.poll).toBe(polls);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('still refetches a spectator when the tab becomes visible', async () => {
    const { result } = renderHook(() => useGameState('ROOM', true));
    await drain();
    const reads = mocks.state.counts.fullRow;
    mocks.state.liveRow = gameRow({ turn_number: 2 });
    await showPage();
    expect(mocks.state.counts.fullRow).toBeGreaterThan(reads);
    expect(result.current.gameRow?.turn_number).toBe(2);
  });
});

describe('useGameState bot', () => {
  function armBot(): void {
    seat();
    localStorage.setItem('stratego:ROOM:botToken', 'bot-secret');
    mocks.state.liveRow = gameRow({
      is_bot_game: true,
      status: 'active',
      current_turn_slot: 2,
      bot_difficulty: 'easy',
      bot_personality: 'aggressive',
    });
    mocks.state.botMoves = [];
  }

  it('fires one bot move under StrictMode', async () => {
    armBot();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, combatResult: null, winnerSlot: null });
    renderHook(() => useGameState('ROOM', false), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    await drain();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await drain();

    const moves = vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'make-move');
    expect(moves).toHaveLength(1);
    expect(moves[0]?.[1]).toMatchObject({
      token: 'bot-secret',
      from: { row: 0, col: 0 },
      to: { row: 1, col: 0 },
    });
    expect(chooseBotMove).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending bot move when the hook unmounts', async () => {
    armBot();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, combatResult: null, winnerSlot: null });
    const { unmount } = renderHook(() => useGameState('ROOM', false));
    await drain();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await drain();
    expect(vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'make-move')).toHaveLength(0);
  });

  it('does not move the bot without a stored bot token', async () => {
    seat();
    mocks.state.liveRow = gameRow({ is_bot_game: true, status: 'active', current_turn_slot: 2 });
    renderHook(() => useGameState('ROOM', false));
    await drain();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await drain();
    expect(chooseBotMove).not.toHaveBeenCalled();
    expect(vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'make-move')).toHaveLength(0);
  });

  it('retries a rejected bot move and then stops', async () => {
    armBot();
    vi.mocked(callFunction)
      .mockRejectedValueOnce(new Error('NOT_YOUR_TURN'))
      .mockRejectedValueOnce(new Error('ILLEGAL_MOVE'))
      .mockResolvedValueOnce({ ok: true, combatResult: null, winnerSlot: null });

    renderHook(() => useGameState('ROOM', false));
    await drain();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await drain();

    expect(vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'make-move')).toHaveLength(3);
  });

  it('sets a bot error after five failed attempts', async () => {
    armBot();
    vi.mocked(callFunction).mockRejectedValue(new Error('NOPE'));
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await drain();
    expect(vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'make-move')).toHaveLength(5);
    expect(result.current.botError).toMatch(/legal move/i);
  });

  it('stops when the bot has no legal move', async () => {
    armBot();
    vi.mocked(chooseBotMove).mockReturnValue(null);
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await drain();
    expect(vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'make-move')).toHaveLength(0);
    expect(result.current.botError).toBeNull();
  });
});

describe('useGameState actions', () => {
  it('ignores a second move while the first is in flight', async () => {
    seat();
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.mocked(callFunction).mockImplementation((name: string) => {
      if (name === 'make-move') return pending as Promise<{ ok: true; combatResult: null; winnerSlot: null }>;
      return Promise.resolve({ ok: true });
    });

    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.submitMove({ row: 6, col: 0 }, { row: 5, col: 0 });
      second = result.current.submitMove({ row: 6, col: 1 }, { row: 5, col: 1 });
    });

    await expect(second).rejects.toThrow(/in flight/i);
    expect(vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'make-move')).toHaveLength(1);

    await act(async () => {
      release({
        ok: true,
        combatResult: { outcome: 'ATTACKER_WINS', attackerRank: '5', defenderRank: '8', defenderPieceId: 'e' },
        winnerSlot: null,
      });
      await expect(first).resolves.toMatchObject({ outcome: 'ATTACKER_WINS' });
    });
  });

  it('sends trimmed chat and refreshes when a message is inserted', async () => {
    seat();
    vi.mocked(callFunction).mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    await act(async () => {
      await result.current.sendChat('   ');
    });
    expect(callFunction).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.sendChat('  hello  ');
    });
    expect(callFunction).toHaveBeenCalledWith('send-chat', { token: 'seat-token', body: 'hello' });

    mocks.state.chat = [{ player_slot: 2, body: 'yo', created_at: 't2' }];
    await act(async () => {
      mocks.handlers.chat?.();
    });
    await drain();
    expect(result.current.chat.map((message) => message.body)).toEqual(['yo']);
  });

  it('resigns with the seat token', async () => {
    seat();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, winnerSlot: 2 });
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();
    await act(async () => {
      await result.current.resign();
    });
    expect(callFunction).toHaveBeenCalledWith('resign', { token: 'seat-token' });
  });

  it('stores the new room as slot 1 on rematch and slot 2 on accept', async () => {
    seat();
    mocks.state.liveRow = gameRow({ status: 'finished', turn_number: 4, winner_slot: 1 });
    vi.mocked(callFunction).mockResolvedValue({ roomCode: 'NEW1', token: 'new-token', yourSlot: 1 });
    const { result } = renderHook(() => useGameState('ROOM', false));
    await drain();

    let created: { roomCode: string; token: string } = { roomCode: '', token: '' };
    await act(async () => {
      created = await result.current.rematch();
    });
    expect(created).toEqual({ roomCode: 'NEW1', token: 'new-token' });
    expect(localStorage.getItem('stratego:NEW1:slot')).toBe('1');
    expect(callFunction).toHaveBeenCalledWith('rematch', { token: 'seat-token' });

    await act(async () => {
      mocks.handlers.game?.({ new: { rematch_room_code: 'NEXT', status: 'finished' } });
    });
    await drain();
    vi.mocked(callFunction).mockResolvedValue({ token: 'joined', gameId: 'g2' });
    await act(async () => {
      await result.current.acceptRematch();
    });
    expect(callFunction).toHaveBeenCalledWith('join-game', { roomCode: 'NEXT' });
    expect(localStorage.getItem('stratego:NEXT:token')).toBe('joined');
    expect(localStorage.getItem('stratego:NEXT:slot')).toBe('2');
  });
});
