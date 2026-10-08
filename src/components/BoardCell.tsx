import type { JSX, KeyboardEvent, ReactNode } from 'react';

export type CellSubject =
  | { kind: 'lake' }
  | { kind: 'empty' }
  | { kind: 'piece'; side: 'you' | 'enemy' | 'p1' | 'p2'; rankName: string | null };

export function boardCellLabel(coord: string, subject: CellSubject): string {
  if (subject.kind === 'lake') return 'Lake';
  if (subject.kind === 'empty') return `Empty square ${coord}`;
  return `${piecePhrase(subject.side, subject.rankName)} at ${coord}`;
}

function piecePhrase(side: 'you' | 'enemy' | 'p1' | 'p2', rankName: string | null): string {
  if (side === 'you') return rankName ? `Your ${rankName}` : 'Your piece';
  if (side === 'enemy') return rankName ? `Enemy ${rankName}` : 'Enemy piece';
  const who = side === 'p1' ? 'Player 1' : 'Player 2';
  return rankName ? `${who} ${rankName}` : `${who} piece`;
}

interface BoardCellProps {
  label: string;
  lake?: boolean;
  selected?: boolean;
  onActivate: () => void;
  children?: ReactNode;
}

export function BoardCell({
  label,
  lake = false,
  selected = false,
  onActivate,
  children,
}: BoardCellProps): JSX.Element {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onActivate();
  }

  const className = ['board-cell', lake ? 'lake' : '', selected ? 'selected' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected ? true : undefined}
      className={className}
      onClick={onActivate}
      onKeyDown={onKeyDown}
    >
      {lake ? '~' : children}
    </div>
  );
}
