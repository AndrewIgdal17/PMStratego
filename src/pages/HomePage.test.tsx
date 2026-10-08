/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLocation, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callFunction, supabase } from '../lib/supabaseClient.ts';
import { HomePage } from './HomePage.tsx';

const botPlacements = [{ rank: 'FLAG', row: 0, col: 9 }];

vi.mock('../lib/supabaseClient.ts', () => ({
  callFunction: vi.fn(),
  supabase: { rpc: vi.fn() },
}));

vi.mock('../bot/bot.ts', () => ({
  pickBotFormationPlacements: () => botPlacements,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderHome(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/setup" element={<LocationProbe />} />
        <Route path="/game" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function isDisabled(name: string): boolean {
  const button = screen.getByRole('button', { name });
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${name} is not a button`);
  return button.disabled;
}

function submitNamed(name: string): void {
  const input = screen.getByRole('textbox', { name });
  if (!(input instanceof HTMLInputElement) || !input.form) {
    throw new Error(`${name} is not in a form`);
  }
  fireEvent.submit(input.form);
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(callFunction).mockReset();
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as never);
});

describe('HomePage create, join, and spectate', () => {
  it('keeps New Game disabled after success and builds a setup invite', async () => {
    vi.mocked(callFunction).mockResolvedValue({
      roomCode: 'ABCD1234',
      token: 'host-token',
      invitePath: '/setup.html?code=ABCD1234&join=1',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));

    expect(await screen.findByText('Room created!')).toBeTruthy();
    expect(screen.getByText('ABCD1234')).toBeTruthy();
    expect(isDisabled('New Game')).toBe(true);
    expect(localStorage.getItem('stratego:ABCD1234:token')).toBe('host-token');
    expect(localStorage.getItem('stratego:ABCD1234:slot')).toBe('1');
    expect(callFunction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
    expect(callFunction).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/setup?code=ABCD1234&join=1`);
    });
    expect(writeText.mock.calls[0]?.[0]).not.toContain('.html');

    fireEvent.click(screen.getByRole('button', { name: 'Continue to setup' }));
    expect(screen.getByTestId('location').textContent).toBe('/setup?code=ABCD1234');
  });

  it('shows Creating... and re-enables New Game when create fails', async () => {
    let rejectCreate: (reason: unknown) => void = () => {};
    vi.mocked(callFunction).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCreate = reject;
        }),
    );

    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));
    expect(isDisabled('Creating...')).toBe(true);

    await act(async () => {
      rejectCreate(new Error('ROOM_FAILED'));
    });
    const error = await screen.findByText('Failed to create game: ROOM_FAILED');
    expect(error.hidden).toBe(false);
    expect(isDisabled('New Game')).toBe(false);
  });

  it('joins with an uppercased room code as slot 2', async () => {
    let resolveJoin: (value: { token: string; gameId: string }) => void = () => {};
    vi.mocked(callFunction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve;
        }),
    );

    renderHome();
    fireEvent.change(screen.getByRole('textbox', { name: 'Join room code' }), {
      target: { value: 'ab12cd' },
    });
    submitNamed('Join room code');

    expect(isDisabled('Joining...')).toBe(true);
    await act(async () => {
      resolveJoin({ token: 'guest-token', gameId: 'game-1' });
    });

    expect(screen.getByTestId('location').textContent).toBe('/setup?code=AB12CD');
    expect(callFunction).toHaveBeenCalledWith('join-game', { roomCode: 'AB12CD' });
    expect(localStorage.getItem('stratego:AB12CD:token')).toBe('guest-token');
    expect(localStorage.getItem('stratego:AB12CD:slot')).toBe('2');
  });

  it('spectates without a network call', () => {
    renderHome();
    fireEvent.change(screen.getByRole('textbox', { name: 'Spectate room code' }), {
      target: { value: 'spec1234' },
    });
    submitNamed('Spectate room code');

    expect(screen.getByTestId('location').textContent).toBe('/game?code=SPEC1234&spectate=1');
    expect(callFunction).not.toHaveBeenCalled();
  });
});

describe('HomePage play vs bot', () => {
  it('abandons the room and clears the session when setup fails', async () => {
    vi.mocked(callFunction).mockImplementation(async (name: string) => {
      if (name === 'create-game') {
        return { roomCode: 'BOTROOM1', token: 'human-token', invitePath: '/setup.html?code=BOTROOM1&join=1' };
      }
      if (name === 'join-game') return { token: 'bot-token', gameId: 'game-bot' };
      if (name === 'submit-setup') throw new Error('SETUP_FAILED');
      if (name === 'abandon-game') return { ok: true };
      throw new Error(`unexpected ${name}`);
    });

    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Play vs Bot' }));

    const error = await screen.findByText('Failed to start bot game: SETUP_FAILED');
    expect(error.hidden).toBe(false);
    expect(vi.mocked(callFunction).mock.calls.map((call) => call[0])).toEqual([
      'create-game',
      'join-game',
      'submit-setup',
      'abandon-game',
    ]);
    expect(callFunction).toHaveBeenCalledWith('create-game', { isBotGame: true });
    expect(callFunction).toHaveBeenCalledWith('join-game', { roomCode: 'BOTROOM1' });
    expect(callFunction).toHaveBeenCalledWith('submit-setup', {
      token: 'bot-token',
      placements: botPlacements,
    });
    expect(callFunction).toHaveBeenCalledWith('abandon-game', { token: 'human-token' });
    expect(localStorage.getItem('stratego:BOTROOM1:token')).toBeNull();
    expect(localStorage.getItem('stratego:BOTROOM1:slot')).toBeNull();
    expect(localStorage.getItem('stratego:BOTROOM1:botToken')).toBeNull();
    expect(isDisabled('Play vs Bot')).toBe(false);
  });

  it('still clears the session when abandon-game fails', async () => {
    vi.mocked(callFunction).mockImplementation(async (name: string) => {
      if (name === 'create-game') {
        return { roomCode: 'BOTROOM2', token: 'human-token', invitePath: '/setup.html' };
      }
      if (name === 'join-game') throw new Error('JOIN_FAILED');
      if (name === 'abandon-game') throw new Error('ABANDON_FAILED');
      throw new Error(`unexpected ${name}`);
    });

    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Play vs Bot' }));

    expect(await screen.findByText('Failed to start bot game: JOIN_FAILED')).toBeTruthy();
    expect(callFunction).toHaveBeenCalledWith('abandon-game', { token: 'human-token' });
    expect(localStorage.getItem('stratego:BOTROOM2:token')).toBeNull();
    expect(localStorage.getItem('stratego:BOTROOM2:slot')).toBeNull();
    expect(localStorage.getItem('stratego:BOTROOM2:botToken')).toBeNull();
  });

  it('does not abandon a room when create-game itself fails', async () => {
    vi.mocked(callFunction).mockRejectedValue(new Error('NOPE'));

    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Play vs Bot' }));

    expect(await screen.findByText('Failed to start bot game: NOPE')).toBeTruthy();
    expect(callFunction).toHaveBeenCalledTimes(1);
    expect(callFunction).not.toHaveBeenCalledWith('abandon-game', expect.anything());
    expect(isDisabled('Play vs Bot')).toBe(false);
  });
});

describe('HomePage leaderboard', () => {
  it('escapes usernames and switches percent suffixes by category', async () => {
    const nasty = '<img src=x onerror=alert(1)>';
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string, args?: { p_category?: string }) => {
      if (fn === 'get_leaderboard') {
        return {
          data: [
            {
              username: nasty,
              rating: 1500,
              wins: 3,
              losses: 1,
              win_rate: 75,
              longest_streak: 4,
            },
          ],
          error: null,
        };
      }
      if (fn === 'get_micro_leaderboard' && args?.p_category === 'spy_rate') {
        return { data: [{ username: 'bea', value: 40 }], error: null };
      }
      if (fn === 'get_micro_leaderboard' && args?.p_category === 'trade_efficiency') {
        return { data: [{ username: 'cy', value: 1.25 }], error: null };
      }
      return { data: [], error: null };
    }) as never);

    renderHome();

    expect(await screen.findByText('75%')).toBeTruthy();
    expect(screen.getByText(nasty)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    const profile = screen.getByRole('link', { name: nasty });
    expect(profile.getAttribute('href')).toBe(`/profile?user=${encodeURIComponent(nasty)}`);
    expect(screen.getByText('No ranked players yet.').hidden).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Best Spy%' }));
    expect(await screen.findByText('40%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Trade King' }));
    expect(await screen.findByText('1.25')).toBeTruthy();
    expect(screen.queryByText('1.25%')).toBeNull();
  });

  it('shows the empty state when the rating board has no rows', async () => {
    renderHome();
    const empty = await screen.findByText('No ranked players yet.');
    await waitFor(() => {
      expect(empty.hidden).toBe(false);
    });
  });
});
