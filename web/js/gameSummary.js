export function materialSparkline(curve, playerSlot) {
  if (!curve || curve.length === 0) return "";
  const data = playerSlot === 1 ? curve : curve.map((v) => -v);
  const w = 180;
  const h = 50;
  const pad = 4;
  const labelPad = 18;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const range = max - min || 1;
  const finalVal = data[data.length - 1];

  function yPos(v) {
    return pad + (1 - (v - min) / range) * (h - 2 * pad);
  }

  const points = data
    .map((v, i) => {
      const x = labelPad + (i / Math.max(data.length - 1, 1)) * (w - labelPad - pad);
      return `${x},${yPos(v)}`;
    })
    .join(" ");

  const zeroY = yPos(0);

  // Area fill under the curve (to zero line)
  const firstX = labelPad;
  const lastX = labelPad + (w - labelPad - pad);
  const areaPoints = `${firstX},${zeroY} ${points} ${lastX},${zeroY}`;

  // Color based on final value
  const color = finalVal >= 0 ? "100,200,150" : "200,100,100";

  // Y-axis labels
  const topLabel = max > 0 ? `+${max}` : `${max}`;
  const botLabel = min < 0 ? `${min}` : `${min}`;

  // Final value badge
  const badge = finalVal >= 0 ? `+${finalVal}` : `${finalVal}`;
  const badgeColor = finalVal >= 0 ? "#6c6" : "#c66";

  return `<div class="curve-container" data-tooltip="Material advantage over ${data.length} combats. Final: ${badge} rank-value.">
    <svg viewBox="0 0 ${w} ${h}" class="material-spark-lg">
      <text x="2" y="${pad + 3}" font-size="5" fill="rgba(255,255,255,0.4)">${topLabel}</text>
      <text x="2" y="${h - pad + 1}" font-size="5" fill="rgba(255,255,255,0.4)">${botLabel}</text>
      <line x1="${labelPad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" stroke-dasharray="2,2"/>
      <polygon points="${areaPoints}" fill="rgba(${color},0.1)"/>
      <polyline points="${points}" fill="none" stroke="rgba(${color},0.8)" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <span class="curve-badge" style="color:${badgeColor}">${badge}</span>
  </div>`;
}

export function infoEdgeSparkline(curve) {
  if (!curve || curve.length === 0) {
    return `<div class="info-edge-empty">No combat information exchanges</div>`;
  }
  const w = 320;
  const h = 64;
  const pad = 4;
  const min = Math.min(...curve, 0);
  const max = Math.max(...curve, 0);
  const span = Math.max(max - min, 1);
  const pts = curve
    .map((v, i) => {
      const x = pad + (i / Math.max(curve.length - 1, 1)) * (w - 2 * pad);
      const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
      return `${x},${y}`;
    })
    .join(" ");
  const zeroY = pad + (1 - (0 - min) / span) * (h - 2 * pad);
  return `
    <svg viewBox="0 0 ${w} ${h}" class="info-edge-spark">
      <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
      <polyline fill="none" stroke="#6bcb8a" stroke-width="1.5" points="${pts}"/>
    </svg>`;
}
