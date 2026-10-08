import { RANK_NAME, type Slot } from '../types.ts';

export interface PieceCareer {
  player_slot: number;
  rank: string | number;
  kills: number;
  moves_made: number;
  distance: number;
  alive: boolean;
  death_move: number | null;
}

interface PieceCareersProps {
  careers: PieceCareer[];
  slot: Slot;
}

export function PieceCareers({ careers, slot }: PieceCareersProps) {
  const notable = careers
    .filter((piece) => piece.player_slot === slot && (piece.kills > 0 || piece.moves_made >= 10))
    .sort((a, b) => b.kills - a.kills || b.moves_made - a.moves_made)
    .slice(0, 12);
  if (notable.length === 0) return null;

  return (
    <div id="game-pieces">
      <h3>
        Piece Careers{' '}
        <span
          className="stat-help"
          data-tooltip="Notable pieces — kills > 0 or 10+ moves. All 80 pieces tracked; only standouts shown."
        >
          ?
        </span>
      </h3>
      <table className="history-table piece-career-table">
        <thead>
          <tr>
            <th>Piece</th>
            <th>Kills</th>
            <th>Moves</th>
            <th>Distance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {notable.map((piece, index) => (
            <tr key={`${piece.player_slot}-${piece.rank}-${index}`}>
              <td>{RANK_NAME[piece.rank] ?? String(piece.rank)}</td>
              <td>{piece.kills}</td>
              <td>{piece.moves_made}</td>
              <td>{`${piece.distance} sq`}</td>
              <td>{piece.alive ? 'Survived' : `Died move ${piece.death_move}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
