import { useLayoutEffect, useRef, type JSX } from 'react';
import { toDisplay, type ViewSlot } from '../lib/gameHelpers.ts';
import { RANK_NAME, RANK_SHORT, type FogPiece, type MoveRow, type Slot } from '../types.ts';

interface MoveLogProps {
  moves: MoveRow[];
  pieces: Map<string, FogPiece>;
  mySlot: ViewSlot;
  isSpectator: boolean;
  isBotGame: boolean;
}

function squareName(absRow: number, absCol: number, mySlot: ViewSlot): string {
  const { row, col } = toDisplay(absRow, absCol, mySlot);
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

function rankTitle(rank: string | null | undefined): string {
  if (rank == null || rank === '') return '';
  return RANK_NAME[rank] ?? rank;
}

function rankShort(rank: string | null | undefined): string {
  if (rank == null || rank === '') return '';
  return RANK_SHORT[rank] ?? rank;
}

function actorName(slot: Slot, mySlot: ViewSlot, isSpectator: boolean, isBotGame: boolean): string {
  if (isSpectator) return isBotGame && slot === 2 ? 'Bot' : `P${slot}`;
  if (slot === mySlot) return 'You';
  return isBotGame ? 'Bot' : 'Opponent';
}

function formatMoveLine(
  move: MoveRow,
  pieces: Map<string, FogPiece>,
  mySlot: ViewSlot,
  isSpectator: boolean,
  isBotGame: boolean,
): string {
  const who = actorName(move.player_slot, mySlot, isSpectator, isBotGame);
  const from = squareName(move.from_row, move.from_col, mySlot);
  const to = squareName(move.to_row, move.to_col, mySlot);
  if (move.move_type === 'attack') {
    const attacker = rankTitle(move.attacker_rank);
    const defender = rankTitle(move.defender_rank);
    return `${who}: ${from} → ${to} (${attacker} vs ${defender}: ${move.outcome ?? ''})`;
  }
  const revealRank = isSpectator || move.player_slot === mySlot;
  if (!revealRank) return `${who}: ${from} → ${to}`;
  const title = rankShort(pieces.get(move.piece_id)?.rank);
  return title ? `${who}: ${title} ${from} → ${to}` : `${who}: ${from} → ${to}`;
}

export function MoveLog({
  moves,
  pieces,
  mySlot,
  isSpectator,
  isBotGame,
}: MoveLogProps): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);
  const stickRef = useRef(true);

  function onScroll(): void {
    const list = listRef.current;
    if (!list) return;
    stickRef.current = list.scrollTop + list.clientHeight >= list.scrollHeight - 5;
  }

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !stickRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [moves]);

  return (
    <ul id="move-log" ref={listRef} onScroll={onScroll}>
      {moves.map((move) => (
        <li key={move.move_number}>
          {formatMoveLine(move, pieces, mySlot, isSpectator, isBotGame)}
        </li>
      ))}
    </ul>
  );
}
