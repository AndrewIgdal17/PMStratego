/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../contexts/AuthContext.tsx';
import { supabase } from '../lib/supabaseClient.ts';
import { zeroPlayerStats, type Player } from '../lib/profileStats.ts';
import { ProfilePage } from './ProfilePage.tsx';

vi.mock('../lib/supabaseClient.ts', () => ({
  AUTH_TOKEN_STORAGE_KEY: 'stratego:authToken',
  callFunction: vi.fn(),
  setAuthTokenGetter: vi.fn(),
  supabase: { rpc: vi.fn() },
}));

const ada: Player = {
  id: 'player-ada',
  username: 'Ada',
  rating: 1200,
  rating_provisional: true,
  games_played: 3,
  created_at: '2026-01-15T00:00:00.000Z',
};

function profilePayload(player: Player = ada) {
  return {
    player,
    stats: zeroPlayerStats({
      wins: 2,
      losses: 1,
      archetype: 'lake_walker',
      info_archetype: 'bluffer',
      kills_by_rank: { '1': 2 },
      attack_heatmap: { '0,0': { attacks: 4, wins: 3 } },
    }),
    achievements: [{ achievement_key: 'phoenix', unlocked_at: '2026-02-01', game_id: null }],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderProfile(search = '?user=Ada'): void {
  render(
    <MemoryRouter initialEntries={[`/profile${search}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/game-detail" element={<LocationProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  document.title = 'Stratego';
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation((async (fn: string) => {
    if (fn === 'get_game_history') return { data: [], error: null };
    return { data: null, error: null };
  }) as never);
});

describe('ProfilePage', () => {
  it('asks for a username and reports a missing player', async () => {
    renderProfile('');
    expect(screen.getByText('No username specified')).toBeTruthy();
    cleanup();

    renderProfile('?user=missing');
    expect(await screen.findByText('Player not found')).toBeTruthy();
  });

  it('renders the profile as text and skips head-to-head when logged out', async () => {
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string, args?: { p_username?: string }) => {
      if (fn === 'get_player_profile' && args?.p_username === '<b>x</b>') {
        return {
          data: profilePayload({ ...ada, username: '<b>x</b>' }),
          error: null,
        };
      }
      if (fn === 'get_game_history') return { data: [], error: null };
      return { data: null, error: null };
    }) as never);

    renderProfile('?user=%3Cb%3Ex%3C%2Fb%3E');
    const heading = await screen.findByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('<b>x</b>');
    expect(heading.querySelector('b')).toBeNull();
    expect(screen.getByText('Hyperactive Bluffer')).toBeTruthy();
    expect(screen.getByText('(Provisional)', { exact: false })).toBeTruthy();
    expect(await screen.findByText('No games yet.')).toBeTruthy();
    expect(screen.queryByText(/Head-to-Head/)).toBeNull();
    expect(document.title).toBe('Stratego — <b>x</b>');
    expect(vi.mocked(supabase.rpc).mock.calls.some((call) => call[0] === 'get_head_to_head')).toBe(false);
  });

  it('shows head-to-head only against a different logged-in player', async () => {
    localStorage.setItem('stratego:authToken', 'tok');
    localStorage.setItem('stratego:username', 'Me');
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string, args?: { p_username?: string }) => {
      if (fn === 'get_player_profile' && args?.p_username === 'Ada') {
        return { data: profilePayload(), error: null };
      }
      if (fn === 'get_player_profile' && args?.p_username === 'Me') {
        return {
          data: profilePayload({ ...ada, id: 'player-me', username: 'Me' }),
          error: null,
        };
      }
      if (fn === 'get_head_to_head') {
        return {
          data: { p1_wins: 3, p2_wins: 1, draws: 0, total_games: 4, avg_moves: 40 },
          error: null,
        };
      }
      if (fn === 'get_game_history') return { data: [], error: null };
      return { data: null, error: null };
    }) as never);

    renderProfile();
    expect(await screen.findByText('Head-to-Head vs Ada')).toBeTruthy();
    expect(screen.getByText('3W')).toBeTruthy();
    expect(screen.getByText('1L')).toBeTruthy();
    expect(screen.getByText('4 games, avg 40 moves')).toBeTruthy();
  });

  it('shows oldest form on the left and opens a game from the row', async () => {
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string) => {
      if (fn === 'get_player_profile') return { data: profilePayload(), error: null };
      if (fn === 'get_game_history') {
        return {
          data: [
            {
              game_id: 'new-game',
              opponent_username: 'Newer',
              player_slot: 1,
              winner_slot: 2,
              turn_number: 12,
              created_at: '2026-04-02T00:00:00.000Z',
            },
            {
              game_id: 'old-game',
              opponent_username: 'Older',
              player_slot: 1,
              winner_slot: 1,
              turn_number: 30,
              created_at: '2026-04-01T00:00:00.000Z',
            },
          ],
          error: null,
        };
      }
      if (fn === 'get_game_summary') return { data: { material_curve_p1: [1] }, error: null };
      return { data: null, error: null };
    }) as never);

    renderProfile();
    const pills = await screen.findAllByText(/^[WLD]$/);
    expect(pills.map((pill) => pill.textContent).join('')).toBe('WL');
    const row = screen.getByRole('link', { name: 'Newer' }).closest('tr');
    if (!row) throw new Error('missing history row');
    fireEvent.click(row);
    expect(await screen.findByTestId('location')).toHaveProperty(
      'textContent',
      '/game-detail?id=new-game&slot=1',
    );
  });

  it('loads material curves five at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];
    const games = Array.from({ length: 8 }, (_, index) => ({
      game_id: `game-${index}`,
      opponent_username: `Opp${index}`,
      player_slot: index % 2 === 0 ? 1 : 2,
      winner_slot: index % 2 === 0 ? 1 : 2,
      turn_number: 10 + index,
      created_at: '2026-03-01T00:00:00.000Z',
    }));

    vi.mocked(supabase.rpc).mockImplementation((async (fn: string) => {
      if (fn === 'get_player_profile') return { data: profilePayload(), error: null };
      if (fn === 'get_game_history') return { data: games, error: null };
      if (fn === 'get_game_summary') {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => {
          release.push(resolve);
        });
        inFlight -= 1;
        return { data: { material_curve_p1: [1, -2] }, error: null };
      }
      return { data: null, error: null };
    }) as never);

    renderProfile();
    await waitFor(() => {
      expect(release).toHaveLength(5);
      expect(screen.getByText('Last 8:')).toBeTruthy();
    });
    expect(maxInFlight).toBe(5);
    expect(screen.getAllByText('W')).toHaveLength(8);

    for (let wave = 0; wave < 4 && document.querySelectorAll('.curve-badge').length < 8; wave += 1) {
      const pending = release.splice(0);
      await act(async () => {
        for (const resolve of pending) resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(document.querySelectorAll('.curve-badge')).toHaveLength(8));
    expect(maxInFlight).toBe(5);
  });
});
