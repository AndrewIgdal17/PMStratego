import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart } from '../components/LineChart.tsx';
import { PhaseBreakdownTable } from '../components/PhaseBreakdownTable.tsx';
import { PieceCareers, type PieceCareer } from '../components/PieceCareers.tsx';
import { StoryHighlights, type GameStory } from '../components/StoryHighlights.tsx';
import { TerritoryTimeline, type TerritorySample } from '../components/TerritoryTimeline.tsx';
import { perspectiveCurve } from '../lib/chartGeometry.ts';
import { supabase } from '../lib/supabaseClient.ts';
import type { Slot } from '../types.ts';

interface LoadedGame {
  player1_username: string;
  player2_username: string;
  winner_slot: Slot | null;
  turn_number: number | null;
  created_at: string;
  materialCurve: number[];
  story: GameStory;
}

function asSlot(value: unknown): Slot | null {
  return value === 1 || value === 2 ? value : null;
}

function readCurve(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) return [];
  return value;
}

function readStory(value: unknown): GameStory {
  if (!value || typeof value !== 'object') return {};
  return value as GameStory;
}

function readGame(data: unknown): LoadedGame | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (!row.summary || typeof row.summary !== 'object') return null;
  const summary = row.summary as Record<string, unknown>;
  return {
    player1_username: typeof row.player1_username === 'string' ? row.player1_username : '',
    player2_username: typeof row.player2_username === 'string' ? row.player2_username : '',
    winner_slot: asSlot(row.winner_slot),
    turn_number: typeof row.turn_number === 'number' ? row.turn_number : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    materialCurve: readCurve(summary.material_curve_p1),
    story: readStory(summary.story),
  };
}

function readCareers(story: GameStory): PieceCareer[] {
  return Array.isArray(story.piece_careers) ? story.piece_careers : [];
}

function readTerritory(story: GameStory): TerritorySample[] {
  return Array.isArray(story.territory_timeline) ? story.territory_timeline : [];
}

function seriesForSlot(curves: GameStory['info_edge_curve'], slot: Slot): number[] {
  const series = slot === 1 ? curves?.slot1 : curves?.slot2;
  return Array.isArray(series) ? series : [];
}

interface GameHeaderProps {
  game: LoadedGame;
  gameId: string;
  viewSlot: Slot;
  onSelectSlot: (slot: Slot) => void;
}

function GameHeader({ game, gameId, viewSlot, onSelectSlot }: GameHeaderProps) {
  const winner =
    game.winner_slot === 1 ? game.player1_username : game.winner_slot === 2 ? game.player2_username : 'Draw';
  const result = winner === 'Draw' ? 'Draw' : `${winner} wins`;
  const moves = game.turn_number ?? '\u2014';
  const when = new Date(game.created_at).toLocaleString();

  return (
    <div id="game-header">
      <h2>{`${game.player1_username} vs ${game.player2_username}`}</h2>
      <p className="game-detail-subtitle" data-tooltip="Rated human game — stats computed at game end">
        {`${result} \u00b7 ${moves} moves \u00b7 ${when}`}
      </p>
      <p className="game-detail-view-toggle">
        {'Viewing as: '}
        <a
          href={`?id=${gameId}&slot=1`}
          className={viewSlot === 1 ? 'active' : ''}
          onClick={(event) => {
            event.preventDefault();
            onSelectSlot(1);
          }}
        >
          {game.player1_username}
        </a>
        {' \u00b7 '}
        <a
          href={`?id=${gameId}&slot=2`}
          className={viewSlot === 2 ? 'active' : ''}
          onClick={(event) => {
            event.preventDefault();
            onSelectSlot(2);
          }}
        >
          {game.player2_username}
        </a>
      </p>
    </div>
  );
}

export function GameDetailPage() {
  const [params] = useSearchParams();
  const gameId = params.get('id');
  const [viewSlot, setViewSlot] = useState<Slot>(() => (params.get('slot') === '2' ? 2 : 1));
  const [game, setGame] = useState<LoadedGame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      setGame(null);
      setError('No game ID specified');
      return;
    }

    let cancelled = false;
    setGame(null);
    setError(null);

    void (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_game_detail', { p_game_id: gameId });
      if (cancelled) return;
      const loaded = rpcError ? null : readGame(data);
      if (!loaded) {
        setError('Game not found or no summary available');
        return;
      }
      setGame(loaded);
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const turningIndex = game?.story.turning_point?.combat_index ?? null;

  return (
    <div className="page-shell">
      <main className="page-frame game-detail-page">
        {game && gameId ? (
          <>
            <GameHeader game={game} gameId={gameId} viewSlot={viewSlot} onSelectSlot={setViewSlot} />
            <StoryHighlights data={game} story={game.story} slot={viewSlot} />
            <div id="game-material-curve">
              <LineChart
                title="Material Curve"
                tooltip="Rank-value advantage after each combat. Above zero = you are ahead. Y-axis shows peak and trough."
                series={perspectiveCurve(game.materialCurve, viewSlot)}
                markerIndex={turningIndex}
              />
            </div>
            <div id="game-info-edge">
              <LineChart
                title="Information Edge"
                tooltip="Asymmetric knowledge advantage after each combat: Scout inferences + elimination deductions you hold minus those the enemy holds. Pure combat reveals are symmetric and do not move this curve."
                series={seriesForSlot(game.story.info_edge_curve, viewSlot)}
              />
            </div>
            <div id="game-compositional-knowledge">
              <LineChart
                title="Compositional Knowledge"
                tooltip="How much you can deduce about remaining enemy pieces from what you've already eliminated — rises as you kill more"
                series={seriesForSlot(game.story.compositional_knowledge_curve, viewSlot)}
              />
            </div>
            <PhaseBreakdownTable phaseStats={game.story.phase_stats} slot={viewSlot} />
            <PieceCareers careers={readCareers(game.story)} slot={viewSlot} />
            <TerritoryTimeline timeline={readTerritory(game.story)} />
          </>
        ) : null}
        {error ? (
          <p id="game-error" className="error">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}
