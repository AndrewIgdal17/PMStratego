import { Fragment, useState, type JSX, type KeyboardEvent } from 'react';
import { ARMY_COMPOSITION } from '../rules/pieces.ts';
import { RANK_SHORT, type FogPiece, type Slot } from '../types.ts';

const RANKS = ARMY_COMPOSITION.map((entry) => ({
  rank: String(entry.rank),
  abbr: RANK_SHORT[entry.rank] ?? String(entry.rank),
  count: entry.count,
}));

export type GraveyardMode =
  | { kind: 'mine' }
  | { kind: 'enemy'; ranks: Map<string, string> | null }
  | { kind: 'slot'; slot: Slot };

interface GraveyardTrayProps {
  title: string;
  titleClass: 'enemy-label' | 'back-label';
  pieces: FogPiece[];
  mode: GraveyardMode;
  playerColor: string;
}

function shown(piece: FogPiece, mode: GraveyardMode): boolean {
  if (piece.alive) return false;
  if (mode.kind === 'mine') return piece.is_mine;
  if (mode.kind === 'enemy') return !piece.is_mine;
  return piece.player_slot === mode.slot;
}

function rankOf(piece: FogPiece, mode: GraveyardMode): string | null {
  if (piece.rank != null) return String(piece.rank);
  if (mode.kind !== 'enemy' || !mode.ranks) return null;
  return mode.ranks.get(piece.piece_id) ?? null;
}

export function GraveyardTray({
  title,
  titleClass,
  pieces,
  mode,
  playerColor,
}: GraveyardTrayProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const deadByRank = new Map<string, number>();
  for (const piece of pieces) {
    if (!shown(piece, mode)) continue;
    const rank = rankOf(piece, mode);
    if (rank == null) continue;
    deadByRank.set(rank, (deadByRank.get(rank) ?? 0) + 1);
  }

  function toggle(): void {
    setCollapsed((value) => !value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  }

  const tone = mode.kind === 'mine' ? 'mine' : 'enemy';

  return (
    <div className={collapsed ? 'graveyard collapsed' : 'graveyard'}>
      <div
        className="graveyard-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className={`graveyard-label ${titleClass}`}>{title}</span>
        <span className="graveyard-chevron">▼</span>
      </div>
      <div className="graveyard-body">
        <div className="graveyard-tray">
          {RANKS.map((entry, index) => {
            const deadCount = deadByRank.get(entry.rank) ?? 0;
            return (
              <Fragment key={entry.rank}>
                {index > 0 ? <div className="graveyard-divider" /> : null}
                <div className="graveyard-column">
                  <span className="graveyard-rank-label">{entry.abbr}</span>
                  {Array.from({ length: entry.count }, (_, slot) => {
                    const filled = slot < deadCount;
                    const className = filled
                      ? `graveyard-slot filled-${tone}`
                      : `graveyard-slot empty-${tone}`;
                    return (
                      <div
                        key={slot}
                        className={className}
                        style={filled && tone === 'mine' ? { backgroundColor: playerColor } : undefined}
                      >
                        {filled ? entry.abbr : null}
                      </div>
                    );
                  })}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
