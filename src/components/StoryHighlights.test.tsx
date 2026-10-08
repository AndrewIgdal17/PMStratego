/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHighlights, StoryHighlights, type GameStory } from './StoryHighlights.tsx';

const players = { player1_username: '<b>Ada</b>', player2_username: 'Bea' };

const story: GameStory = {
  turning_point: { combat_index: 1, move_number: 8 },
  piece_careers: [
    { player_slot: 1, rank: '1', kills: 3, moves_made: 4, distance: 12, alive: false, death_move: 20 },
    { player_slot: 1, rank: '9', kills: 0, moves_made: 2, distance: 1, alive: true, death_move: null },
    { player_slot: 2, rank: '2', kills: 5, moves_made: 6, distance: 8, alive: true, death_move: null },
  ],
  kill_chains: {
    slot1: { length: 3, start_move: 4, end_move: 9 },
    slot2: { length: 2, start_move: 1, end_move: 2 },
  },
  flag_proximity: { slot1: 1, slot2: 6 },
  first_casualty: { killed_by_rank: '9', player_slot: 2, rank: '8', move_number: 3 },
  think_times: { p1_avg_ms: 2500, p1_max_ms: 8000, p2_avg_ms: 0, p2_max_ms: 0 },
};

afterEach(() => {
  cleanup();
});

describe('buildHighlights', () => {
  it('builds the slot-1 narrative in source order', () => {
    expect(buildHighlights(players, story, 1).map((item) => `${item.icon} ${item.text}`)).toEqual([
      "<b>Ada</b>'s MVP: Marshal \u2014 3 kills, 4 moves".replace(/^/, '\u2b50 '),
      'Most dangerous enemy: General killed 5 of yours'.replace(/^/, '\u{1f480} '),
      '<b>Ada</b> went on a 3-kill streak (moves 4\u20139)'.replace(/^/, '\u{1f525} '),
      'Turning point at combat #2 (move 8) \u2014 material lead never changed after'.replace(/^/, '\u{1f4c8} '),
      'Enemy got within 1 square of your Flag'.replace(/^/, '\u{1f6a9} '),
      "First blood: Scout killed Bea's Miner at move 3".replace(/^/, '\u{1fa78} '),
      '<b>Ada</b> avg think time: 2.5s (max 8s)'.replace(/^/, '\u23f1\ufe0f '),
    ]);
  });

  it('drops slot-2 beats that miss the thresholds', () => {
    const texts = buildHighlights(players, story, 2).map((item) => item.text);
    expect(texts[0]).toBe("Bea's MVP: General \u2014 5 kills, 6 moves");
    expect(texts[1]).toBe('Most dangerous enemy: Marshal killed 3 of yours');
    expect(texts.some((text) => text.includes('kill streak'))).toBe(false);
    expect(texts.some((text) => text.includes('Flag'))).toBe(false);
    expect(texts.some((text) => text.includes('think time'))).toBe(false);
    expect(texts.some((text) => text.includes("Bea's Miner"))).toBe(true);
  });

  it('treats a 5-square flag approach as close and an unknown rank as ?', () => {
    const highlights = buildHighlights(players, {
      piece_careers: [
        { player_slot: 1, rank: 'ZZ', kills: 1, moves_made: 1, distance: 0, alive: true, death_move: null },
      ],
      flag_proximity: { slot1: 5, slot2: null },
    }, 1);
    expect(highlights.map((item) => item.text)).toEqual([
      "<b>Ada</b>'s MVP: ? \u2014 1 kills, 1 moves",
      'Enemy got within 5 squares of your Flag',
    ]);
  });

  it('returns nothing when the story has no beats for this perspective', () => {
    expect(buildHighlights(players, {}, 1)).toEqual([]);
  });
});

describe('StoryHighlights', () => {
  it('renders highlight text as text and says so when the list is empty', () => {
    const view = render(<StoryHighlights data={players} story={story} slot={1} />);
    const mvp = screen.getByText(/<b>Ada<\/b>'s MVP/);
    expect(mvp.querySelector('b')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(view.container.querySelector('.highlight-item .highlight-icon')?.textContent).toBe('\u2b50');
    view.unmount();

    render(<StoryHighlights data={players} story={{}} slot={1} />);
    expect(screen.getByText('No highlights for this perspective.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Story Highlights/ })).toBeTruthy();
  });
});
