import { useCallback, useEffect, useRef, useState } from 'react';
import { chooseBotMove } from '../bot/bot.ts';
import { shouldApplyGameRow } from '../lib/gameHelpers.ts';
import { getBotToken, getRoomSession, saveRoomSession } from '../lib/roomSession.ts';
import { callFunction, supabase } from '../lib/supabaseClient.ts';
import type {
  BotMoveRow,
  ChatMessage,
  CombatResult,
  FogPiece,
  GameRow,
  GameStatus,
  MoveRow,
  Slot,
  Square,
} from '../types.ts';
import type { ViewSlot } from '../lib/gameHelpers.ts';

const BOT_SLOT: Slot = 2;
const POLL_MS = 5000;
const BOT_DELAY_MS = 1000;
const BOT_MAX_ATTEMPTS = 5;
const BOT_STUCK = "Bot couldn't find a legal move — try Resign or Rematch.";

const GAME_ROW_COLUMNS =
  'status, current_turn_slot, turn_number, winner_slot, is_bot_game, bot_difficulty, bot_personality, rematch_room_code';
const POLL_COLUMNS = 'current_turn_slot, status, winner_slot, turn_number, rematch_room_code';
const MOVE_COLUMNS =
  'move_number, player_slot, piece_id, from_row, from_col, to_row, to_col, move_type, outcome, attacker_rank, defender_rank';
const BOT_MOVE_COLUMNS = `${MOVE_COLUMNS}, defender_piece_id`;
const CHAT_COLUMNS = 'player_slot, body, created_at';

export interface GameActions {
  gameRow: GameRow | null;
  pieces: Map<string, FogPiece>;
  moves: MoveRow[];
  chat: ChatMessage[];
  loading: boolean;
  error: string | null;
  mySlot: ViewSlot;
  rematchCode: string | null;
  botError: string | null;
  submitMove: (from: Square, to: Square) => Promise<CombatResult>;
  sendChat: (body: string) => Promise<void>;
  resign: () => Promise<void>;
  rematch: () => Promise<{ roomCode: string; token: string }>;
  acceptRematch: () => Promise<{ roomCode: string; token: string }>;
  dismissRematch: () => void;
}

interface PollSnap {
  status: GameStatus;
  turn_number: number;
  rematch_room_code: string | null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'UNKNOWN_ERROR';
}

function isGameStatus(value: unknown): value is GameStatus {
  return value === 'setup' || value === 'active' || value === 'finished';
}

function readGameRow(data: unknown): GameRow | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Partial<GameRow>;
  if (!isGameStatus(row.status) || typeof row.turn_number !== 'number') return null;
  return {
    id: row.id,
    status: row.status,
    current_turn_slot: row.current_turn_slot ?? null,
    turn_number: row.turn_number,
    winner_slot: row.winner_slot ?? null,
    is_bot_game: Boolean(row.is_bot_game),
    bot_difficulty: row.bot_difficulty ?? null,
    bot_personality: row.bot_personality ?? null,
    rematch_room_code: row.rematch_room_code ?? null,
  };
}

function readPoll(data: unknown): PollSnap | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Partial<GameRow>;
  if (!isGameStatus(row.status) || typeof row.turn_number !== 'number') return null;
  return {
    status: row.status,
    turn_number: row.turn_number,
    rematch_room_code: row.rematch_room_code ?? null,
  };
}

function readPieces(data: unknown): FogPiece[] | null {
  if (!Array.isArray(data)) return null;
  return data as FogPiece[];
}

function readMoves(data: unknown): MoveRow[] | null {
  if (!Array.isArray(data)) return null;
  return data as MoveRow[];
}

function readBotMoves(data: unknown): BotMoveRow[] | null {
  if (!Array.isArray(data)) return null;
  return data.map((item) => {
    const row = item as BotMoveRow;
    return { ...row, defender_piece_id: row.defender_piece_id ?? null };
  });
}

function readChat(data: unknown): ChatMessage[] | null {
  if (!Array.isArray(data)) return null;
  return data as ChatMessage[];
}

async function loadGameId(roomCode: string): Promise<string> {
  const { data, error } = await supabase.from('games').select('id').eq('room_code', roomCode).single();
  if (error || !data || typeof data !== 'object' || !('id' in data) || data.id == null || data.id === '') {
    throw new Error('Game not found');
  }
  return String(data.id);
}

async function fetchGameRow(gameId: string): Promise<GameRow | null> {
  const { data, error } = await supabase.from('games').select(GAME_ROW_COLUMNS).eq('id', gameId).single();
  if (error || !data) return null;
  return readGameRow(data);
}

async function fetchPoll(gameId: string): Promise<PollSnap | null> {
  const { data, error } = await supabase.from('games').select(POLL_COLUMNS).eq('id', gameId).single();
  if (error || !data) return null;
  return readPoll(data);
}

async function fetchMoves(gameId: string): Promise<MoveRow[] | null> {
  const { data, error } = await supabase
    .from('moves')
    .select(MOVE_COLUMNS)
    .eq('game_id', gameId)
    .order('move_number', { ascending: true });
  if (error) return null;
  return readMoves(data);
}

async function fetchBotMoves(gameId: string): Promise<BotMoveRow[] | null> {
  const { data, error } = await supabase
    .from('moves')
    .select(BOT_MOVE_COLUMNS)
    .eq('game_id', gameId)
    .order('move_number', { ascending: true });
  if (error) return null;
  return readBotMoves(data);
}

async function fetchChat(gameId: string): Promise<ChatMessage[] | null> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select(CHAT_COLUMNS)
    .eq('game_id', gameId)
    .order('created_at', { ascending: true });
  if (error) return null;
  return readChat(data);
}

export function useGameState(roomCode: string, isSpectator: boolean): GameActions {
  const session = isSpectator ? null : getRoomSession(roomCode);
  const mySlot: ViewSlot = isSpectator ? 0 : (session?.slot ?? 0);
  const botToken = isSpectator ? null : getBotToken(roomCode);

  const [gameRow, setGameRow] = useState<GameRow | null>(null);
  const [pieces, setPieces] = useState<Map<string, FogPiece>>(() => new Map());
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rematchCode, setRematchCode] = useState<string | null>(null);
  const [botError, setBotError] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

  const gameRowRef = useRef<GameRow | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const rematchCodeRef = useRef<string | null>(null);
  const moveInFlight = useRef(false);
  const refreshGen = useRef(0);
  const botPhase = useRef<'idle' | 'waiting' | 'running'>('idle');
  const botGen = useRef(0);
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spectatorRef = useRef(isSpectator);
  const roomRef = useRef(roomCode);
  const tokenRef = useRef(session?.token ?? null);

  spectatorRef.current = isSpectator;
  roomRef.current = roomCode;
  tokenRef.current = session?.token ?? null;
  rematchCodeRef.current = rematchCode;

  const applyGameRow = useCallback((next: GameRow): void => {
    const prev = gameRowRef.current;
    if (!shouldApplyGameRow(next, prev)) return;
    gameRowRef.current = next;
    setGameRow(next);
    if (
      !spectatorRef.current &&
      next.status === 'finished' &&
      next.rematch_room_code &&
      next.rematch_room_code !== prev?.rematch_room_code
    ) {
      rematchCodeRef.current = next.rematch_room_code;
      setRematchCode(next.rematch_room_code);
    }
  }, []);

  const refreshPieces = useCallback(async (): Promise<FogPiece[] | null> => {
    if (spectatorRef.current) {
      const { data, error: rpcError } = await supabase.rpc('get_spectator_state', {
        p_room_code: roomRef.current,
      });
      if (rpcError) return null;
      return readPieces(data);
    }
    const token = tokenRef.current;
    if (!token) return null;
    const { data, error: rpcError } = await supabase.rpc('get_game_state', { p_token: token });
    if (rpcError) return null;
    return readPieces(data);
  }, []);

  const refreshTrio = useCallback(
    async (id: string): Promise<void> => {
      const gen = ++refreshGen.current;
      const row = await fetchGameRow(id);
      if (gen !== refreshGen.current) return;
      if (row) applyGameRow(row);

      const pieceRows = await refreshPieces();
      if (gen !== refreshGen.current) return;
      if (pieceRows) setPieces(new Map(pieceRows.map((piece) => [piece.piece_id, piece])));

      const moveRows = await fetchMoves(id);
      if (gen !== refreshGen.current) return;
      if (moveRows) setMoves(moveRows);
    },
    [applyGameRow, refreshPieces],
  );

  const refreshChat = useCallback(async (id: string): Promise<void> => {
    const rows = await fetchChat(id);
    if (rows) setChat(rows);
  }, []);

  const cancelWaitingBot = useCallback((): void => {
    if (botPhase.current !== 'waiting') return;
    botGen.current += 1;
    if (botTimer.current != null) {
      clearTimeout(botTimer.current);
      botTimer.current = null;
    }
    botPhase.current = 'idle';
  }, []);

  const runBotMove = useCallback(
    async (id: string, token: string): Promise<void> => {
      const row = gameRowRef.current;
      const difficulty = row?.bot_difficulty ?? 'medium';
      const personality = row?.bot_personality ?? 'neutral';
      for (let attempt = 0; attempt < BOT_MAX_ATTEMPTS; attempt += 1) {
        const { data: rows, error: stateError } = await supabase.rpc('get_game_state', { p_token: token });
        if (stateError || !rows) continue;
        const pieceRows = readPieces(rows);
        if (!pieceRows) continue;

        const moveRows = await fetchBotMoves(id);
        if (!moveRows) continue;

        const move = chooseBotMove(
          pieceRows,
          BOT_SLOT,
          moveRows,
          difficulty,
          moveRows.length,
          Math.random,
          personality,
        );
        if (!move) return;

        try {
          await callFunction('make-move', { token, from: move.from, to: move.to });
          await refreshTrio(id);
          setBotError(null);
          return;
        } catch {
          // The server rejected this attempt. Try again with a fresh board.
        }
      }
      setBotError(BOT_STUCK);
    },
    [refreshTrio],
  );

  const scheduleBot = useCallback((): void => {
    if (botPhase.current !== 'idle') return;
    if (spectatorRef.current) return;
    const id = gameIdRef.current;
    const token = getBotToken(roomRef.current);
    const row = gameRowRef.current;
    if (!id || !token || !row) return;
    if (!row.is_bot_game || row.status !== 'active' || row.current_turn_slot !== BOT_SLOT) return;

    const gen = ++botGen.current;
    botPhase.current = 'waiting';
    botTimer.current = setTimeout(() => {
      botTimer.current = null;
      if (botGen.current !== gen) {
        botPhase.current = 'idle';
        return;
      }
      botPhase.current = 'running';
      void runBotMove(id, token).finally(() => {
        if (botGen.current === gen) botPhase.current = 'idle';
      });
    }, BOT_DELAY_MS);
  }, [runBotMove]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setGameId(null);
    setGameRow(null);
    setPieces(new Map());
    setMoves([]);
    setChat([]);
    setRematchCode(null);
    setBotError(null);
    gameRowRef.current = null;
    gameIdRef.current = null;
    rematchCodeRef.current = null;
    refreshGen.current += 1;

    async function load(): Promise<void> {
      if (!isSpectator && !getRoomSession(roomCode)) {
        if (!cancelled) {
          setError('No access token found for this room.');
          setLoading(false);
        }
        return;
      }
      try {
        const id = await loadGameId(roomCode);
        if (cancelled) return;
        gameIdRef.current = id;
        await refreshTrio(id);
        if (cancelled) return;
        await refreshChat(id);
        if (cancelled) return;
        setGameId(id);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(errorText(err));
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      refreshGen.current += 1;
    };
  }, [roomCode, isSpectator, refreshTrio, refreshChat]);

  useEffect(() => {
    if (!gameId) return;
    const id = gameId;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    channel = supabase
      .channel(`game-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` },
        (payload) => {
          const next = payload.new as Partial<GameRow>;
          if (
            typeof next.rematch_room_code === 'string' &&
            next.rematch_room_code &&
            !spectatorRef.current &&
            next.status === 'finished'
          ) {
            rematchCodeRef.current = next.rematch_room_code;
            setRematchCode(next.rematch_room_code);
          }
          void refreshTrio(id);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `game_id=eq.${id}` },
        () => {
          void refreshChat(id);
        },
      )
      .subscribe();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [gameId, refreshTrio, refreshChat]);

  useEffect(() => {
    if (!gameId || isSpectator) return;
    const id = gameId;
    const timer = setInterval(() => {
      void (async () => {
        const snap = await fetchPoll(id);
        if (!snap) return;
        const current = gameRowRef.current;
        const changed =
          snap.turn_number !== current?.turn_number ||
          snap.status !== current?.status ||
          (snap.rematch_room_code != null && snap.rematch_room_code !== (current?.rematch_room_code ?? null));
        if (changed) await refreshTrio(id);
        scheduleBot();
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [gameId, isSpectator, refreshTrio, scheduleBot]);

  useEffect(() => {
    if (!gameId) return;
    const id = gameId;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshTrio(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [gameId, refreshTrio]);

  useEffect(() => {
    scheduleBot();
    return () => cancelWaitingBot();
  }, [
    scheduleBot,
    cancelWaitingBot,
    gameId,
    botToken,
    gameRow?.is_bot_game,
    gameRow?.status,
    gameRow?.current_turn_slot,
  ]);

  const requireToken = useCallback((): string => {
    const token = tokenRef.current;
    if (!token) throw new Error('No access token found for this room.');
    return token;
  }, []);

  const submitMove = useCallback(
    async (from: Square, to: Square): Promise<CombatResult> => {
      if (moveInFlight.current) throw new Error('Move already in flight');
      const token = requireToken();
      const id = gameIdRef.current;
      moveInFlight.current = true;
      try {
        const result = await callFunction('make-move', { token, from, to });
        if (id) await refreshTrio(id);
        setError(null);
        return result.combatResult;
      } catch (err) {
        if (id) await refreshTrio(id);
        const message = errorText(err);
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        moveInFlight.current = false;
      }
    },
    [refreshTrio, requireToken],
  );

  const sendChat = useCallback(
    async (body: string): Promise<void> => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const token = requireToken();
      try {
        await callFunction('send-chat', { token, body: trimmed });
        setError(null);
      } catch (err) {
        const message = errorText(err);
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [requireToken],
  );

  const resign = useCallback(async (): Promise<void> => {
    const token = requireToken();
    const id = gameIdRef.current;
    try {
      await callFunction('resign', { token });
      if (id) await refreshTrio(id);
      setError(null);
    } catch (err) {
      const message = errorText(err);
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, [refreshTrio, requireToken]);

  const rematch = useCallback(async (): Promise<{ roomCode: string; token: string }> => {
    const token = requireToken();
    try {
      const result = await callFunction('rematch', { token });
      saveRoomSession(result.roomCode, result.token, result.yourSlot);
      setError(null);
      return { roomCode: result.roomCode, token: result.token };
    } catch (err) {
      const message = errorText(err);
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, [requireToken]);

  const acceptRematch = useCallback(async (): Promise<{ roomCode: string; token: string }> => {
    const code = rematchCodeRef.current;
    if (!code) throw new Error('NO_REMATCH');
    try {
      const result = await callFunction('join-game', { roomCode: code });
      saveRoomSession(code, result.token, 2);
      setError(null);
      return { roomCode: code, token: result.token };
    } catch (err) {
      const message = errorText(err);
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, []);

  const dismissRematch = useCallback((): void => {
    rematchCodeRef.current = null;
    setRematchCode(null);
  }, []);

  return {
    gameRow,
    pieces,
    moves,
    chat,
    loading,
    error,
    mySlot,
    rematchCode,
    botError,
    submitMove,
    sendChat,
    resign,
    rematch,
    acceptRematch,
    dismissRematch,
  };
}
