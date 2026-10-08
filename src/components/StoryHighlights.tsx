import type { PieceCareer } from './PieceCareers.tsx';
import type { PhaseStats } from './PhaseBreakdownTable.tsx';
import type { TerritorySample } from './TerritoryTimeline.tsx';
import { RANK_NAME, type Slot } from '../types.ts';

export interface GameDetailNames {
  player1_username: string;
  player2_username: string;
}

export interface Highlight {
  icon: string;
  text: string;
  tooltip: string;
}

export interface KillChain {
  length: number;
  start_move: number;
  end_move: number;
}

export interface GameStory {
  turning_point?: { combat_index: number; move_number: number } | null;
  info_edge_curve?: { slot1?: number[]; slot2?: number[] } | null;
  compositional_knowledge_curve?: { slot1?: number[]; slot2?: number[] } | null;
  phase_stats?: PhaseStats | null;
  piece_careers?: PieceCareer[] | null;
  territory_timeline?: TerritorySample[] | null;
  kill_chains?: { slot1?: KillChain | null; slot2?: KillChain | null } | null;
  flag_proximity?: { slot1?: number | null; slot2?: number | null } | null;
  first_casualty?: {
    killed_by_rank: string | number;
    player_slot: number;
    rank: string | number;
    move_number: number;
  } | null;
  think_times?: {
    p1_avg_ms?: number | null;
    p2_avg_ms?: number | null;
    p1_max_ms?: number | null;
    p2_max_ms?: number | null;
  } | null;
}

function slotName(slot: number, data: GameDetailNames): string {
  return slot === 1 ? data.player1_username : data.player2_username;
}

function rankLabel(rank: string | number): string {
  return RANK_NAME[rank] ?? '?';
}

function slotField<T>(slot: Slot, record: { slot1?: T; slot2?: T } | null | undefined): T | undefined {
  if (!record) return undefined;
  return slot === 1 ? record.slot1 : record.slot2;
}

export function buildHighlights(data: GameDetailNames, story: GameStory, slot: Slot): Highlight[] {
  const highlights: Highlight[] = [];
  const name = slotName(slot, data);
  const careers = (story.piece_careers ?? []).filter((piece) => piece.player_slot === slot);
  const enemyCareers = (story.piece_careers ?? []).filter((piece) => piece.player_slot !== slot);

  const mvp = [...careers].sort((a, b) => b.kills - a.kills)[0];
  if (mvp && mvp.kills > 0) {
    highlights.push({
      icon: '⭐',
      text: `${name}'s MVP: ${rankLabel(mvp.rank)} \u2014 ${mvp.kills} kills, ${mvp.moves_made} moves`,
      tooltip: 'Your piece with the most kills this game',
    });
  }

  const deadliestEnemy = [...enemyCareers].sort((a, b) => b.kills - a.kills)[0];
  if (deadliestEnemy && deadliestEnemy.kills > 0) {
    highlights.push({
      icon: '💀',
      text: `Most dangerous enemy: ${rankLabel(deadliestEnemy.rank)} killed ${deadliestEnemy.kills} of yours`,
      tooltip: 'Enemy piece that eliminated the most of your army',
    });
  }

  const chain = slotField(slot, story.kill_chains);
  if (chain && chain.length >= 3) {
    highlights.push({
      icon: '🔥',
      text: `${name} went on a ${chain.length}-kill streak (moves ${chain.start_move}\u2013${chain.end_move})`,
      tooltip: 'Longest streak of consecutive combat wins without the opponent getting a kill',
    });
  }

  if (story.turning_point) {
    highlights.push({
      icon: '📈',
      text: `Turning point at combat #${story.turning_point.combat_index + 1} (move ${story.turning_point.move_number}) \u2014 material lead never changed after`,
      tooltip: 'Last combat where rank-value advantage permanently flipped',
    });
  }

  const proximity = slotField(slot, story.flag_proximity);
  if (proximity !== null && proximity !== undefined && proximity <= 5) {
    highlights.push({
      icon: '🚩',
      text: `Enemy got within ${proximity} square${proximity === 1 ? '' : 's'} of your Flag`,
      tooltip: "Minimum Manhattan distance from any enemy move destination to your Flag's board coordinates",
    });
  }

  const casualty = story.first_casualty;
  if (casualty) {
    highlights.push({
      icon: '🩸',
      text: `First blood: ${rankLabel(casualty.killed_by_rank)} killed ${slotName(casualty.player_slot, data)}'s ${rankLabel(casualty.rank)} at move ${casualty.move_number}`,
      tooltip: 'First piece eliminated in combat',
    });
  }

  const think = story.think_times;
  const average = think?.[slot === 1 ? 'p1_avg_ms' : 'p2_avg_ms'];
  const peak = think?.[slot === 1 ? 'p1_max_ms' : 'p2_max_ms'];
  if (average) {
    highlights.push({
      icon: '⏱️',
      text: `${name} avg think time: ${(average / 1000).toFixed(1)}s (max ${((peak ?? 0) / 1000).toFixed(0)}s)`,
      tooltip: 'Time between consecutive moves (capped at 10 min — overnight gaps ignored)',
    });
  }

  return highlights;
}

interface StoryHighlightsProps {
  data: GameDetailNames;
  story: GameStory;
  slot: Slot;
}

export function StoryHighlights({ data, story, slot }: StoryHighlightsProps) {
  const highlights = buildHighlights(data, story, slot);
  return (
    <div id="game-story">
      <h3>
        Story Highlights{' '}
        <span
          className="stat-help"
          data-tooltip="Key narrative beats from this game — MVP, kill chains, turning points, flag pressure, tempo"
        >
          ?
        </span>
      </h3>
      <div className="story-highlights">
        {highlights.length === 0 ? (
          <p className="muted">No highlights for this perspective.</p>
        ) : (
          highlights.map((item, index) => (
            <div className="highlight-item" key={`${item.icon}-${index}`}>
              <span className="highlight-icon">{item.icon}</span>
              <span className="highlight-text">{item.text}</span>
              <span className="stat-help" data-tooltip={item.tooltip}>
                ?
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
