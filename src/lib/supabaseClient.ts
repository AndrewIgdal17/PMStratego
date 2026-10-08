import { createClient } from '@supabase/supabase-js';
import type { CombatResult, Difficulty, Personality, Slot, Square } from '../types.ts';

// Public anon key. It grants no access to pieces or game_players.
// Sensitive operations go through an Edge Function or an RPC.
const SUPABASE_URL = 'https://cafqbrzaxcwewwtyqpnf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mxrVhbM1gbEixsbuhyn6sw_eL7r6dRX';

export const AUTH_TOKEN_STORAGE_KEY = 'stratego:authToken';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function readStoredAuthToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

// AuthProvider replaces this. callFunction must not import the auth module.
let getToken: () => string | null = readStoredAuthToken;

export function setAuthTokenGetter(getter: () => string | null): void {
  getToken = getter;
}

export interface Placement {
  rank: string | number;
  row: number;
  col: number;
}

export interface AuthSession {
  token: string;
  username: string;
}

/** Bodies and success payloads for the 14 browser Edge Functions. */
export interface EdgeFunctionMap {
  'create-game': {
    body: { isBotGame?: boolean };
    response: { roomCode: string; token: string; invitePath: string };
  };
  'join-game': {
    body: { roomCode: string };
    response: { token: string; gameId: string };
  };
  'abandon-game': {
    body: { token: string };
    response: { ok: true };
  };
  'submit-setup': {
    body: { token: string; placements: Placement[] };
    response: { ok: true; gameStarted: boolean; countdownStarted?: true };
  };
  'unsubmit-setup': {
    body: { token: string };
    response: { ok: true };
  };
  'start-game': {
    body: { token: string };
    response: { ok: true; alreadyActive?: true };
  };
  'set-bot-difficulty': {
    body: { token: string; difficulty: Difficulty };
    response: { ok: true; difficulty: Difficulty };
  };
  'set-bot-personality': {
    body: { token: string; personality: Personality };
    response: { ok: true; personality: Personality };
  };
  'make-move': {
    body: { token: string; from: Square; to: Square };
    response: { ok: true; combatResult: CombatResult; winnerSlot: Slot | null };
  };
  'send-chat': {
    body: { token: string; body: string };
    response: { ok: true };
  };
  resign: {
    body: { token: string };
    response: { ok: true; winnerSlot: Slot };
  };
  rematch: {
    body: { token: string };
    response: { roomCode: string; token: string; yourSlot: 1 };
  };
  login: {
    body: { username: string; password: string };
    response: AuthSession;
  };
  signup: {
    body: { username: string; password: string };
    response: AuthSession;
  };
}

export function callFunction<Name extends keyof EdgeFunctionMap>(
  name: Name,
  body: EdgeFunctionMap[Name]['body'],
): Promise<EdgeFunctionMap[Name]['response']>;
export function callFunction<T = unknown>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T>;
export async function callFunction<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const token = getToken();
  const enrichedBody = token ? { ...body, authToken: token } : body;
  const { data, error } = await supabase.functions.invoke(name, { body: enrichedBody });
  if (error) {
    let message: string | undefined;
    const context = error.context as { json?: () => Promise<{ error?: unknown } | null> } | undefined;
    if (context && typeof context.json === 'function') {
      try {
        const errorBody = await context.json();
        if (typeof errorBody?.error === 'string') message = errorBody.error;
      } catch {
        // response body wasn't JSON
      }
    }
    const dataError =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : undefined;
    const fallback = typeof error.message === 'string' ? error.message : '';
    message = message || dataError || fallback || 'UNKNOWN_ERROR';
    throw new Error(message);
  }
  if (data == null) throw new Error('EMPTY_RESPONSE');
  return data as T;
}
