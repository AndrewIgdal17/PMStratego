import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkline } from './Sparkline.tsx';
import {
  historyMark,
  historyWord,
  mapPool,
  SUMMARY_CONCURRENCY,
  type HistoryGame,
} from '../lib/profileStats.ts';
import { supabase } from '../lib/supabaseClient.ts';
import type { Slot } from '../types.ts';

interface GameHistoryProps {
  username: string;
}

function asSlot(slot: number): Slot {
  return slot === 2 ? 2 : 1;
}

function detailPath(game: HistoryGame): string {
  return `/game-detail?id=${encodeURIComponent(game.game_id)}&slot=${game.player_slot}`;
}

function readCurve(summary: unknown): number[] | null {
  if (!summary || typeof summary !== 'object' || !('material_curve_p1' in summary)) return null;
  const curve = (summary as { material_curve_p1?: unknown }).material_curve_p1;
  if (!Array.isArray(curve) || curve.length === 0) return null;
  if (!curve.every((value) => typeof value === 'number')) return null;
  return curve;
}

export function GameHistory({ username }: GameHistoryProps) {
  const navigate = useNavigate();
  const [games, setGames] = useState<HistoryGame[] | null>(null);
  const [curves, setCurves] = useState<Record<string, number[] | null>>({});

  useEffect(() => {
    let cancelled = false;
    setGames(null);
    setCurves({});

    void (async () => {
      const { data, error } = await supabase.rpc('get_game_history', {
        p_username: username,
        p_limit: 20,
        p_offset: 0,
      });
      if (cancelled) return;
      if (error || !Array.isArray(data) || data.length === 0) {
        setGames([]);
        return;
      }

      const rows = data as HistoryGame[];
      setGames(rows);
      const loaded = await mapPool(rows, SUMMARY_CONCURRENCY, async (game) => {
        const { data: summary, error: summaryError } = await supabase.rpc('get_game_summary', {
          p_game_id: game.game_id,
        });
        if (summaryError) return null;
        return readCurve(summary);
      });
      if (cancelled) return;
      const next: Record<string, number[] | null> = {};
      rows.forEach((game, index) => {
        next[game.game_id] = loaded[index] ?? null;
      });
      setCurves(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [username]);

  if (games === null) return null;
  if (games.length === 0) {
    return (
      <>
        <h3>Game History</h3>
        <p>No games yet.</p>
      </>
    );
  }

  const pills = [...games].reverse();

  return (
    <>
      <h3>Game History</h3>
      <div className="form-sparkline">
        <span className="form-label">Last {games.length}:</span>
        {pills.map((game) => {
          const mark = historyMark(game);
          const cls = mark === 'W' ? 'pill-win' : mark === 'L' ? 'pill-loss' : 'pill-draw';
          const opponent = game.opponent_username || 'Anon';
          return (
            <span
              key={game.game_id}
              className={`form-pill ${cls}`}
              data-tooltip={`vs ${opponent} (${game.turn_number || '?'} moves)`}
            >
              {mark}
            </span>
          );
        })}
      </div>
      <table className="history-table">
        <thead>
          <tr>
            <th>Opponent</th>
            <th>Result</th>
            <th>Moves</th>
            <th>Curve</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => {
            const mark = historyMark(game);
            const word = historyWord(mark);
            const cls = word === 'Win' ? 'win' : word === 'Loss' ? 'loss' : 'draw';
            const opponent = game.opponent_username || 'Anonymous';
            const curve = curves[game.game_id];
            return (
              <tr key={game.game_id} className="clickable-row" onClick={() => navigate(detailPath(game))}>
                <td>
                  <Link
                    to={`/profile?user=${encodeURIComponent(opponent)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {opponent}
                  </Link>
                </td>
                <td className={cls}>{word}</td>
                <td>{game.turn_number || '—'}</td>
                <td className="curve-cell">
                  {curve && curve.length > 0 ? (
                    <Sparkline curve={curve} slot={asSlot(game.player_slot)} />
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <Link to={detailPath(game)} onClick={(event) => event.stopPropagation()}>
                    {new Date(game.created_at).toLocaleDateString()}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
