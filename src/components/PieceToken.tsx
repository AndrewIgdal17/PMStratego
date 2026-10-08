import { useId, type JSX } from 'react';
import { DEFAULT_PLAYER_COLOR } from '../lib/roomSession.ts';
import { RANK_ABBR, RANK_NAME } from '../types.ts';

const ENEMY_COLOR = '#8b4444';
const ENEMY_STROKE = '#6a2a2a';

interface PieceTokenProps {
  rank: string | number | null;
  isMine: boolean;
  color?: string;
}

/** Darken a player color by subtracting 0x20 from each sRGB channel. */
function darkenColor(hex: string): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - 0x20);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - 0x20);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - 0x20);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function PieceToken({
  rank,
  isMine,
  color = DEFAULT_PLAYER_COLOR,
}: PieceTokenProps): JSX.Element {
  const arcId = `arc${useId().replace(/:/g, '')}`;
  const fill = isMine ? color : ENEMY_COLOR;
  const stroke = isMine ? darkenColor(fill) : ENEMY_STROKE;
  const textFill = isMine ? '#e0f0e0' : '#f0d0d0';
  const center = rank != null ? (RANK_ABBR[rank] ?? '?') : '?';
  const name = rank != null ? (RANK_NAME[rank] ?? null) : null;
  const isEmoji = center === '💣' || center === '🚩';
  const isSpy = center === 'S';
  const isTwoDigit = center === '10';
  const centerFontSize = isEmoji ? 20 : isSpy ? 24 : isTwoDigit ? 18 : 22;
  const centerY = isEmoji ? 44 : 46;

  return (
    <svg viewBox="0 0 72 72" className="piece-token">
      <circle cx="36" cy="36" r="33" fill={fill} stroke={stroke} strokeWidth={2.5} />
      <circle
        cx="36"
        cy="36"
        r="27"
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
      />
      {name ? (
        <>
          <defs>
            <path id={arcId} d="M 10,36 a 26,26 0 0,1 52,0" fill="none" />
          </defs>
          <text
            fontSize={7}
            fill={textFill}
            opacity={0.85}
            fontFamily="'TokenScript', serif"
            letterSpacing={1}
          >
            <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
              {name}
            </textPath>
          </text>
        </>
      ) : null}
      <text
        fontSize={centerFontSize}
        fontWeight="bold"
        fontStyle={isSpy ? 'italic' : undefined}
        fill={textFill}
        textAnchor="middle"
        x={36}
        y={centerY}
      >
        {center}
      </text>
    </svg>
  );
}
