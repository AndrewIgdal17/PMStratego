import type { JSX } from 'react';
import {
  getPostCombatRevealRank,
  toAbsolute,
  toDisplay,
  type ViewSlot,
} from '../lib/gameHelpers.ts';
import { BOARD_SIZE, isLake } from '../rules/board.ts';
import { RANK_NAME, type FogPiece, type MoveRow } from '../types.ts';
import { BoardCell, boardCellLabel, type CellSubject } from './BoardCell.tsx';
import { PieceToken } from './PieceToken.tsx';

interface BoardProps {
  pieces: Map<string, FogPiece>;
  moves: MoveRow[];
  mySlot: ViewSlot;
  isSpectator: boolean;
  selectedPieceId: string | null;
  playerColor: string;
  onCellClick: (row: number, col: number, piece: FogPiece | null) => void;
}

function rankTitle(rank: string | null): string | null {
  if (rank == null) return null;
  return RANK_NAME[rank] ?? rank;
}

function subjectFor(
  lake: boolean,
  piece: FogPiece | undefined,
  displayRank: string | null,
  isSpectator: boolean,
): CellSubject {
  if (lake) return { kind: 'lake' };
  if (!piece) return { kind: 'empty' };
  if (isSpectator) {
    return {
      kind: 'piece',
      side: piece.player_slot === 1 ? 'p1' : 'p2',
      rankName: rankTitle(displayRank),
    };
  }
  return {
    kind: 'piece',
    side: piece.is_mine ? 'you' : 'enemy',
    rankName: rankTitle(displayRank),
  };
}

export function Board({
  pieces,
  moves,
  mySlot,
  isSpectator,
  selectedPieceId,
  playerColor,
  onCellClick,
}: BoardProps): JSX.Element {
  const lastMove = moves[moves.length - 1] ?? null;
  const aliveAt = new Map<string, FogPiece>();
  for (const piece of pieces.values()) {
    if (piece.alive) aliveAt.set(`${piece.row_idx},${piece.col_idx}`, piece);
  }

  const columns = Array.from({ length: BOARD_SIZE }, (_, col) => String.fromCharCode(65 + col));
  const rows = Array.from({ length: BOARD_SIZE }, (_, row) => String(row + 1));

  return (
    <>
      <div className="board-col-labels" id="board-col-labels">
        {columns.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="board-inner">
        <div className="board-row-labels" id="board-row-labels">
          {rows.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div
          id="board"
          className="board"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}
        >
          {rows.map((_, displayRow) =>
            columns.map((_, displayCol) => {
              const { row, col } = toAbsolute(displayRow, displayCol, mySlot);
              const lake = isLake(row, col);
              const piece = aliveAt.get(`${row},${col}`);
              const friendly = piece
                ? isSpectator
                  ? piece.player_slot === 1
                  : piece.is_mine
                : false;
              let displayRank = piece?.rank ?? null;
              if (piece && !friendly && displayRank == null) {
                displayRank = getPostCombatRevealRank(piece.piece_id, lastMove, pieces, isSpectator);
              }
              const display = toDisplay(row, col, mySlot);
              const coord = `${String.fromCharCode(65 + display.col)}${display.row + 1}`;
              return (
                <BoardCell
                  key={`${displayRow}-${displayCol}`}
                  label={boardCellLabel(coord, subjectFor(lake, piece, displayRank, isSpectator))}
                  lake={lake}
                  selected={piece?.piece_id === selectedPieceId}
                  onActivate={() => onCellClick(row, col, piece ?? null)}
                >
                  {piece ? (
                    <PieceToken rank={displayRank} isMine={friendly} color={playerColor} />
                  ) : null}
                </BoardCell>
              );
            }),
          )}
        </div>
      </div>
    </>
  );
}
