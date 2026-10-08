/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLocation, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFENSIVE_FORMATIONS } from '../data/formations.ts';
import { cellKey, toAbsolutePlacements } from '../lib/setupPlacement.ts';
import { callFunction } from '../lib/supabaseClient.ts';
import { SetupPage } from './SetupPage.tsx';

const mocks = vi.hoisted(() => {
  const handlers: Array<(payload: { new: Record<string, unknown> }) => void> = [];
  const gameState = {
    row: {
      id: 'game-1',
      is_bot_game: false,
      bot_difficulty: 'medium',
      bot_personality: 'neutral',
    } as Record<string, unknown>,
    fetches: 0,
  };
  const removeChannel = vi.fn(async () => 'ok');
  const channel = vi.fn(() => {
    const api = {
      on: vi.fn(
        (
          _event: string,
          _filter: unknown,
          cb: (payload: { new: Record<string, unknown> }) => void,
        ) => {
          handlers.push(cb);
          return api;
        },
      ),
      subscribe: vi.fn(() => api),
    };
    return api;
  });
  return { handlers, gameState, removeChannel, channel };
});

vi.mock('../lib/supabaseClient.ts', () => ({
  callFunction: vi.fn(),
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            mocks.gameState.fetches += 1;
            return { data: mocks.gameState.row, error: null };
          },
        }),
      }),
    }),
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderSetup(search = '/setup?code=ROOM1') {
  return render(
    <MemoryRouter initialEntries={[search]}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/game" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function seat(slot: '1' | '2' = '1'): void {
  localStorage.setItem('stratego:ROOM1:token', 'seat-token');
  localStorage.setItem('stratego:ROOM1:slot', slot);
}

function clickCell(row: number, col: number): void {
  const cell = document.querySelector(`[data-local-row="${row}"][data-local-col="${col}"]`);
  if (!(cell instanceof HTMLElement)) throw new Error(`missing cell ${row},${col}`);
  fireEvent.click(cell);
}

function occupied(): number {
  return document.querySelectorAll('.territory-cell.occupied').length;
}

function rowLabels(): string[] {
  return [...document.querySelectorAll('#setup-row-labels span')].map((node) => node.textContent ?? '');
}

function submitCalls(): unknown[][] {
  return vi.mocked(callFunction).mock.calls.filter((call) => call[0] === 'submit-setup');
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  localStorage.clear();
  mocks.handlers.length = 0;
  mocks.gameState.fetches = 0;
  mocks.gameState.row = {
    id: 'game-1',
    is_bot_game: false,
    bot_difficulty: 'medium',
    bot_personality: 'neutral',
  };
  vi.mocked(callFunction).mockReset();
  mocks.channel.mockClear();
  mocks.removeChannel.mockClear();
});

describe('SetupPage access', () => {
  it('shows the missing-token message when the invite was not used', () => {
    renderSetup();
    expect(
      screen.getByText(
        'No access token found for this room. Use the link your friend sent you, or create a new game from the home page.',
      ),
    ).toBeTruthy();
    expect(callFunction).not.toHaveBeenCalled();
  });

  it('joins as slot 2 when join=1 and no token is stored', async () => {
    vi.mocked(callFunction).mockResolvedValue({ token: 'joined-token', gameId: 'game-1' });
    renderSetup('/setup?code=ROOM1&join=1');

    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    expect(callFunction).toHaveBeenCalledWith('join-game', { roomCode: 'ROOM1' });
    expect(localStorage.getItem('stratego:ROOM1:token')).toBe('joined-token');
    expect(localStorage.getItem('stratego:ROOM1:slot')).toBe('2');
    expect(rowLabels()).toEqual(['7', '8', '9', '10']);
  });

  it('reports a join failure inside the page', async () => {
    vi.mocked(callFunction).mockRejectedValue(new Error('GAME_FULL'));
    renderSetup('/setup?code=ROOM1&join=1');
    expect(await screen.findByText('Could not join this game: GAME_FULL')).toBeTruthy();
  });
});

describe('SetupPage placement', () => {
  it('labels slot 1 as display rows 7–10 and toggles a piece', async () => {
    seat('1');
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    expect(rowLabels()).toEqual(['7', '8', '9', '10']);
    expect([...document.querySelectorAll('#setup-col-labels span')].map((node) => node.textContent)).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Marshal x1' }));
    expect(document.querySelector('[data-rank="1"]')?.classList.contains('selected')).toBe(true);
    clickCell(0, 0);
    expect(occupied()).toBe(1);
    expect(screen.getByRole('button', { name: 'Marshal x0' }).hasAttribute('disabled')).toBe(true);
    clickCell(0, 0);
    expect(occupied()).toBe(0);
    expect(screen.getByRole('button', { name: 'Submit setup (0/40)' }).hasAttribute('disabled')).toBe(true);
  });

  it('cycles defensive formations, then Clear empties the grid', async () => {
    seat();
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Defensive' }));
    expect(screen.getByText(`Flag Corner Defense (1/${DEFENSIVE_FORMATIONS.length})`)).toBeTruthy();
    expect(occupied()).toBe(40);
    expect(screen.getByRole('button', { name: 'Submit setup' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Defensive' }));
    expect(screen.getByText(`Lake-Back Three-Bomb Surround (2/${DEFENSIVE_FORMATIONS.length})`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(occupied()).toBe(0);
    expect(screen.getByText(`Lake-Back Three-Bomb Surround (2/${DEFENSIVE_FORMATIONS.length})`)).toBeTruthy();
  });

  it('persists the army color', async () => {
    seat();
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    expect(localStorage.getItem('stratego:ROOM1:color')).toBe('#4a7a4a');
    expect(screen.getByRole('button', { name: 'Forest Green' }).classList.contains('selected')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Crimson' }));
    expect(localStorage.getItem('stratego:ROOM1:color')).toBe('#8a3a4a');
    expect(screen.getByRole('button', { name: 'Crimson' }).classList.contains('selected')).toBe(true);
  });
});

describe('SetupPage submit', () => {
  it('remaps slot 2, disables submit before the response, and ignores a second click', async () => {
    seat('2');
    let resolveSubmit: (value: unknown) => void = () => {};
    vi.mocked(callFunction).mockImplementation(((name: string) => {
      if (name === 'submit-setup') {
        return new Promise((resolve) => {
          resolveSubmit = resolve;
        });
      }
      return Promise.resolve({ ok: true });
    }) as typeof callFunction);

    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Defensive' }));

    const submit = screen.getByRole('button', { name: 'Submit setup' });
    fireEvent.click(submit);
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(submitCalls()).toHaveLength(1);

    const formation = DEFENSIVE_FORMATIONS[0];
    if (!formation) throw new Error('missing formation');
    const expected = toAbsolutePlacements(
      new Map(formation.cells.map(([row, col, rank]) => [cellKey(row, col), rank])),
      2,
    );
    const payload = submitCalls()[0]?.[1] as { token: string; placements: typeof expected };
    expect(payload.token).toBe('seat-token');
    expect(payload.placements).toHaveLength(expected.length);
    expect(payload.placements).toEqual(expect.arrayContaining(expected));

    await act(async () => {
      resolveSubmit({ ok: true, gameStarted: false });
    });
    expect(await screen.findByRole('button', { name: 'Unsubmit' })).toBeTruthy();
    expect(screen.getByText('Setup submitted. Waiting for your opponent...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit setup' })).toBeNull();
  });

  it('locks the grid after submit and treats SETUP_ALREADY_SUBMITTED as waiting', async () => {
    seat();
    vi.mocked(callFunction).mockRejectedValue(new Error('SETUP_ALREADY_SUBMITTED'));
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit setup' }));

    expect(await screen.findByRole('button', { name: 'Unsubmit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Defensive' }).hasAttribute('disabled')).toBe(true);
    const before = occupied();
    clickCell(0, 0);
    expect(occupied()).toBe(before);
    await waitFor(() => {
      expect(mocks.channel).toHaveBeenCalledWith('setup-wait-game-1');
    });
  });

  it('navigates when the server says the game already started', async () => {
    seat();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, gameStarted: true });
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit setup' }));
    expect(await screen.findByTestId('location')).toHaveProperty('textContent', '/game?code=ROOM1');
    expect(mocks.channel).not.toHaveBeenCalled();
  });

  it('unsubmits, clears the grid, and removes the channel', async () => {
    seat();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, gameStarted: false });
    const view = renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit setup' }));
    expect(await screen.findByRole('button', { name: 'Unsubmit' })).toBeTruthy();
    await waitFor(() => expect(mocks.channel).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Unsubmit' }));
    expect(await screen.findByRole('button', { name: 'Submit setup (0/40)' })).toBeTruthy();
    expect(screen.getByText('Setup unsubmitted. Rearrange your army and resubmit.')).toBeTruthy();
    await waitFor(() => expect(mocks.removeChannel).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Scout x8' }));
    clickCell(1, 2);
    expect(occupied()).toBe(1);

    view.unmount();
  }, 20_000);

  it('removes the realtime channel on unmount', async () => {
    seat();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, gameStarted: false });
    const view = renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit setup' }));
    await waitFor(() => expect(mocks.channel).toHaveBeenCalledWith('setup-wait-game-1'));
    view.unmount();
    expect(mocks.removeChannel).toHaveBeenCalled();
  });
});

describe('SetupPage countdown and bot controls', () => {
  it('starts a countdown from the opponent and stops it when they unsubmit', async () => {
    seat();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, gameStarted: false });
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit setup' }));
    await waitFor(() => expect(mocks.handlers.length).toBeGreaterThan(0));

    const readyAt = new Date().toISOString();
    act(() => {
      mocks.handlers[0]?.({ new: { status: 'setup', both_submitted_at: readyAt } });
    });
    expect(screen.getByText('Both players ready!')).toBeTruthy();
    expect(screen.getByText(/Game starting in \d+\.\.\./)).toBeTruthy();

    act(() => {
      mocks.handlers[0]?.({ new: { status: 'setup', both_submitted_at: null } });
    });
    expect(screen.getByText('Opponent is rearranging... waiting for them to resubmit.')).toBeTruthy();
    expect(screen.queryByText(/Game starting in/)).toBeNull();
  });

  it('navigates when the game row becomes active', async () => {
    seat();
    vi.mocked(callFunction).mockResolvedValue({ ok: true, gameStarted: false });
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit setup' }));
    await waitFor(() => expect(mocks.handlers.length).toBeGreaterThan(0));

    act(() => {
      mocks.handlers[0]?.({ new: { status: 'active', both_submitted_at: new Date().toISOString() } });
    });
    expect(screen.getByTestId('location').textContent).toBe('/game?code=ROOM1');
  });

  it('counts down ten seconds and still opens the game if start-game fails', async () => {
    vi.useFakeTimers();
    seat();
    vi.mocked(callFunction).mockImplementation(((name: string) => {
      if (name === 'start-game') return Promise.reject(new Error('COUNTDOWN_NOT_FINISHED'));
      return Promise.resolve({ ok: true, gameStarted: false, countdownStarted: true });
    }) as typeof callFunction);

    renderSetup();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Random' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit setup' }));
      await Promise.resolve();
    });

    expect(screen.getByText('Game starting in 10...')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(vi.mocked(callFunction).mock.calls.some((call) => call[0] === 'start-game' && (call[1] as { token: string }).token === 'seat-token')).toBe(true);
    expect(screen.getByTestId('location').textContent).toBe('/game?code=ROOM1');
  });

  it('shows difficulty and personality only for a bot game hosted by slot 1', async () => {
    mocks.gameState.row = {
      id: 'game-1',
      is_bot_game: true,
      bot_difficulty: 'hard',
      bot_personality: 'defensive',
    };
    seat('1');
    vi.mocked(callFunction).mockResolvedValue({ ok: true, difficulty: 'easy', personality: 'aggressive' });
    const first = renderSetup();
    expect(await screen.findByRole('button', { name: 'Easy' }, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hard' }).classList.contains('selected')).toBe(true);
    const personality = screen
      .getAllByRole('button', { name: 'Defensive' })
      .find((button) => button.classList.contains('difficulty-btn'));
    expect(personality?.classList.contains('selected')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Easy' }));
    await waitFor(() => {
      expect(callFunction).toHaveBeenCalledWith('set-bot-difficulty', {
        token: 'seat-token',
        difficulty: 'easy',
      });
    });

    const aggressive = screen
      .getAllByRole('button', { name: 'Aggressive' })
      .find((button) => button.classList.contains('difficulty-btn'));
    if (!aggressive) throw new Error('missing personality button');
    fireEvent.click(aggressive);
    await waitFor(() => {
      expect(callFunction).toHaveBeenCalledWith('set-bot-personality', {
        token: 'seat-token',
        personality: 'aggressive',
      });
    });
    first.unmount();

    seat('2');
    mocks.gameState.fetches = 0;
    renderSetup();
    expect(await screen.findByRole('heading', { name: 'Arrange your army' })).toBeTruthy();
    await waitFor(() => expect(mocks.gameState.fetches).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Easy' })).toBeNull();
  }, 20_000);

  it('shows a difficulty error and leaves the previous choice selected', async () => {
    mocks.gameState.row = {
      id: 'game-1',
      is_bot_game: true,
      bot_difficulty: 'medium',
      bot_personality: 'neutral',
    };
    seat('1');
    vi.mocked(callFunction).mockRejectedValue(new Error('NOT_HOST'));
    renderSetup();
    expect(await screen.findByRole('button', { name: 'Medium' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hard' }));
    expect(await screen.findByText('Failed to set difficulty: NOT_HOST')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medium' }).classList.contains('selected')).toBe(true);
    expect(screen.getByRole('button', { name: 'Hard' }).classList.contains('selected')).toBe(false);
  });
});
