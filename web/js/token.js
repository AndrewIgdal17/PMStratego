// Shared SVG coin tokens for game board and setup screen.

export const RANK_NAME = {
  '1': 'Marshal', '2': 'General', '3': 'Colonel', '4': 'Major',
  '5': 'Captain', '6': 'Lieutenant', '7': 'Sergeant', '8': 'Miner',
  '9': 'Scout', '10': 'Spy', 'BOMB': 'Bomb', 'FLAG': 'Flag',
  1: 'Marshal', 2: 'General', 3: 'Colonel', 4: 'Major',
  5: 'Captain', 6: 'Lieutenant', 7: 'Sergeant', 8: 'Miner',
  9: 'Scout', 10: 'Spy',
};

const RANK_CENTER = {
  '1': '10', '2': '9', '3': '8', '4': '7',
  '5': '6', '6': '5', '7': '4', '8': '3',
  '9': '2', '10': 'S', 'BOMB': '💣', 'FLAG': '🚩',
  1: '10', 2: '9', 3: '8', 4: '7',
  5: '6', 6: '5', 7: '4', 8: '3',
  9: '2', 10: 'S',
};

const ENEMY_COLOR = '#8b4444';
const ENEMY_STROKE = '#6a2a2a';
export const DEFAULT_PLAYER_COLOR = '#4a7a4a';

function darkenColor(hex) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - 0x20);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - 0x20);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - 0x20);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

export function createTokenSVG(rank, isMine, playerColor = DEFAULT_PLAYER_COLOR) {
  const fill = isMine ? playerColor : ENEMY_COLOR;
  const stroke = isMine ? darkenColor(fill) : ENEMY_STROKE;
  const textFill = isMine ? '#e0f0e0' : '#f0d0d0';

  const center = rank != null ? (RANK_CENTER[rank] ?? '?') : '?';
  const name = rank != null ? (RANK_NAME[rank] ?? null) : null;
  const isEmoji = center === '💣' || center === '🚩';
  const isSpy = center === 'S';

  const isTwoDigit = center === '10';
  const centerFontSize = isEmoji ? 20 : (isSpy ? 24 : (isTwoDigit ? 18 : 22));
  const centerStyle = isSpy ? 'font-style="italic"' : '';
  const centerY = isEmoji ? 44 : 46;

  let curvedText = '';
  if (name) {
    const arcId = `arc-${Math.random().toString(36).slice(2, 8)}`;
    curvedText = `
      <defs><path id="${arcId}" d="M 10,36 a 26,26 0 0,1 52,0" fill="none"/></defs>
      <text font-size="7" fill="${textFill}" opacity="0.85" font-family="'TokenScript', serif" letter-spacing="1">
        <textPath href="#${arcId}" startOffset="50%" text-anchor="middle">${name}</textPath>
      </text>`;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 72 72');
  svg.classList.add('piece-token');
  svg.innerHTML = `
    <circle cx="36" cy="36" r="33" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
    <circle cx="36" cy="36" r="27" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    ${curvedText}
    <text font-size="${centerFontSize}" font-weight="bold" ${centerStyle} fill="${textFill}" text-anchor="middle" x="36" y="${centerY}">${center}</text>
  `;
  return svg;
}
