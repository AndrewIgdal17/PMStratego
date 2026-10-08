/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../lib/supabaseClient.ts';
import { App } from '../App.tsx';
import { GameDetailPage } from './GameDetailPage.tsx';

vi.mock('../lib/supabaseClient.ts', () => ({
  AUTH_TOKEN_STORAGE_KEY: 'stratego:authToken',
  callFunction: vi.fn(),
  setAuthTokenGetter: vi.fn(),
  supabase: { rpc: vi.fn() },
}));

const createdAt = '2026-03-01T15:04:00.000Z';

function detailPayload() {
  return {
    game_id: 'g1',
    status: 'finished',
    winner_slot: 1,
    turn_number: 42,
    created_at: createdAt,
    player1_username: '<b>Ada</b>',
    player2_username: 'Bea',
    summary: {
      material_curve_p1: [2, -4, 6],
      story: {
        turning_point: { combat_index: 1, move_number: 8 },
        info_edge_curve: { slot1: [0, 1, 2], slot2: [0, -1, -2] },
        compositional_knowledge_curve: { slot1: [1, 2], slot2: [3, 4] },
        phase_stats: {
          slot1: {
            by_capture_quarter: {
              q1: {
                reveal_wins: 1,
                reveal_attacks: 2,
                trade_sum: 3,
                trade_count: 2,
                attack_wins: 1,
                attacks: 4,
                avenge_kills: 1,
                avenge_opportunities: 2,
              },
            },
          },
          slot2: {},
        },
        piece_careers: [
          { player_slot: 1, rank: '1', kills: 3, moves_made: 4, distance: 12, alive: false, death_move: 20 },
          { player_slot: 1, rank: '9', kills: 0, moves_made: 10, distance: 30, alive: true, death_move: null },
          { player_slot: 1, rank: '8', kills: 0, moves_made: 2, distance: 1, alive: true, death_move: null },
          { player_slot: 2, rank: '2', kills: 5, moves_made: 6, distance: 8, alive: true, death_move: null },
        ],
        territory_timeline: [
          { move_number: 1, p1_in_enemy: 1, p2_in_enemy: 0 },
          { move_number: 2, p1_in_enemy: 3, p2_in_enemy: 2 },
        ],
        kill_chains: {
          slot1: { length: 3, start_move: 4, end_move: 9 },
          slot2: { length: 1, start_move: 2, end_move: 2 },
        },
        flag_proximity: { slot1: 1, slot2: 9 },
        first_casualty: { killed_by_rank: '9', player_slot: 2, rank: '8', move_number: 3 },
        think_times: { p1_avg_ms: 2500, p1_max_ms: 8000, p2_avg_ms: 0, p2_max_ms: 0 },
      },
    },
  };
}

function renderDetail(search = '?id=g1&slot=1'): void {
  render(
    <MemoryRouter initialEntries={[`/game-detail${search}`]}>
      <GameDetailPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockResolvedValue({ data: detailPayload(), error: null } as never);
});

describe('GameDetailPage', () => {
  it('asks for an id and reports a missing summary without rendering the story', async () => {
    renderDetail('');
    expect(screen.getByText('No game ID specified')).toBeTruthy();
    expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled();
    cleanup();

    vi.mocked(supabase.rpc).mockResolvedValue({ data: { summary: null }, error: null } as never);
    renderDetail();
    expect(await screen.findByText('Game not found or no summary available')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Story Highlights/ })).toBeNull();
    cleanup();

    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: 'nope' } } as never);
    renderDetail();
    expect(await screen.findByText('Game not found or no summary available')).toBeTruthy();
  });

  it('renders one fetched game from the requested perspective and escapes names', async () => {
    renderDetail();
    const heading = await screen.findByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('<b>Ada</b> vs Bea');
    expect(heading.querySelector('b')).toBeNull();
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledWith('get_game_detail', { p_game_id: 'g1' });

    const when = new Date(createdAt).toLocaleString();
    expect(screen.getByText(`<b>Ada</b> wins \u00b7 42 moves \u00b7 ${when}`)).toBeTruthy();
    expect(screen.getByRole('link', { name: '<b>Ada</b>' }).classList.contains('active')).toBe(true);
    expect(screen.getByText(/<b>Ada<\/b>'s MVP: Marshal/)).toBeTruthy();
    expect(screen.getByText('-4')).toBeTruthy();
    expect(screen.queryByText('-6')).toBeNull();
    expect(screen.getByRole('heading', { name: /Material Curve/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Information Edge/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Compositional Knowledge/ })).toBeTruthy();
    expect(screen.getByText('Q1').closest('tr')?.textContent).toBe('Q150%1.525%50%4');
    expect(screen.getByText('Q3').closest('tr')?.textContent).toBe('Q3\u2014\u2014\u2014\u2014\u2014');
    expect(screen.getByText('Marshal')).toBeTruthy();
    expect(screen.queryByText('Miner')).toBeNull();
    expect(screen.getByRole('heading', { name: /Territory Control by Lane/ })).toBeTruthy();
  });

  it('changes perspective in place and does not refetch', async () => {
    renderDetail();
    await screen.findByText('-4');
    fireEvent.click(screen.getByRole('link', { name: 'Bea' }));

    expect(screen.getByText('-6')).toBeTruthy();
    expect(screen.queryByText('-4')).toBeNull();
    expect(screen.getByRole('link', { name: 'Bea' }).classList.contains('active')).toBe(true);
    expect(screen.getByRole('link', { name: '<b>Ada</b>' }).classList.contains('active')).toBe(false);
    expect(screen.getByText("Bea's MVP: General \u2014 5 kills, 6 moves")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Phase Breakdown/ })).toBeNull();
    expect(screen.queryByText('Marshal')).toBeNull();
    expect(screen.getByText('General')).toBeTruthy();
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledTimes(1);
  });

  it('opens on the slot query without a second request', async () => {
    renderDetail('?id=g1&slot=2');
    expect(await screen.findByText('-6')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bea' }).classList.contains('active')).toBe(true);
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledTimes(1);
  });

  it('is the /game-detail route', async () => {
    render(
      <MemoryRouter initialEntries={['/game-detail?id=g1&slot=1']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 2 })).toHaveProperty('textContent', '<b>Ada</b> vs Bea');
    expect(screen.queryByText('Coming soon.')).toBeNull();
  });
});
