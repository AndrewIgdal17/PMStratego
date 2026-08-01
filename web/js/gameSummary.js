export function materialSparkline(curve, playerSlot) {
  if (!curve || curve.length === 0) return "";
  const data = playerSlot === 1 ? curve : curve.map((v) => -v);
  const w = 120;
  const h = 30;
  const pad = 2;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = pad + (i / Math.max(data.length - 1, 1)) * (w - 2 * pad);
      const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");

  const zeroY = pad + (1 - (0 - min) / range) * (h - 2 * pad);

  return `<svg viewBox="0 0 ${w} ${h}" class="material-spark">
    <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>
    <polyline points="${points}" fill="none" stroke="rgba(100,200,150,0.8)" stroke-width="1.5"/>
  </svg>`;
}
