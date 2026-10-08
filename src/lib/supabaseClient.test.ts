import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callFunction, setAuthTokenGetter } from './supabaseClient.ts';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke },
  }),
}));

beforeEach(() => {
  invoke.mockReset();
  setAuthTokenGetter(() => null);
});

describe('callFunction', () => {
  it('adds authToken when a token is present and leaves the seat token in place', async () => {
    setAuthTokenGetter(() => 'jwt-1');
    invoke.mockResolvedValue({ data: { ok: true, winnerSlot: 2 }, error: null });

    await callFunction('resign', { token: 'seat' });

    expect(invoke).toHaveBeenCalledWith('resign', {
      body: { token: 'seat', authToken: 'jwt-1' },
    });
  });

  it('omits authToken when logged out', async () => {
    invoke.mockResolvedValue({
      data: { roomCode: 'ABCD1234', token: 'seat', invitePath: '/setup.html?code=ABCD1234&join=1' },
      error: null,
    });

    await callFunction('create-game', {});

    expect(invoke).toHaveBeenCalledWith('create-game', { body: {} });
  });

  it('prefers the JSON error, then data.error, then error.message', async () => {
    invoke.mockResolvedValueOnce({
      data: { error: 'FROM_DATA' },
      error: {
        message: 'FROM_MESSAGE',
        context: { json: async () => ({ error: 'FROM_JSON' }) },
      },
    });
    await expect(callFunction('login', { username: 'ada', password: 'password1' })).rejects.toThrow(
      'FROM_JSON',
    );

    invoke.mockResolvedValueOnce({
      data: { error: 'FROM_DATA' },
      error: {
        message: 'FROM_MESSAGE',
        context: {
          json: async () => {
            throw new Error('not json');
          },
        },
      },
    });
    await expect(callFunction('login', { username: 'ada', password: 'password1' })).rejects.toThrow(
      'FROM_DATA',
    );

    invoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'FROM_MESSAGE' },
    });
    await expect(callFunction('login', { username: 'ada', password: 'password1' })).rejects.toThrow(
      'FROM_MESSAGE',
    );
  });

  it('throws UNKNOWN_ERROR when every fallback is empty', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: '' },
    });
    await expect(callFunction('abandon-game', { token: 'seat' })).rejects.toThrow('UNKNOWN_ERROR');
  });

  it('throws EMPTY_RESPONSE when invoke returns null data and no error', async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    await expect(callFunction('unsubmit-setup', { token: 'seat' })).rejects.toThrow('EMPTY_RESPONSE');
  });

  it('returns the success payload', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(callFunction('unsubmit-setup', { token: 'seat' })).resolves.toEqual({ ok: true });
  });
});
