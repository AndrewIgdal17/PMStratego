import { supabase } from "./supabaseClient.js";
import { renderNavAuth } from "./auth.js";

renderNavAuth(document.getElementById("nav-auth"));

const RANK_NAME = {
  "1": "Marshal", "2": "General", "3": "Colonel", "4": "Major",
  "5": "Captain", "6": "Lieutenant", "7": "Sergeant", "8": "Miner",
  "9": "Scout", "10": "Spy", BOMB: "Bomb", FLAG: "Flag",
};

const params = new URLSearchParams(location.search);
const gameId = params.get("id");
const viewSlot = Number(params.get("slot") || "1");

if (!gameId) {
  document.getElementById("game-error").textContent = "No game ID specified";
  document.getElementById("game-error").hidden = false;
} else {
  loadGameDetail(gameId);
}

async function loadGameDetail(id) {
  const { data, error } = await supabase.rpc("get_game_detail", { p_game_id: id });
  if (error || !data?.summary) {
    document.getElementById("game-error").textContent =
      "Game not found or no summary available";
    document.getElementById("game-error").hidden = false;
    return;
  }

  const story = data.summary.story || {};
  const curveP1 = data.summary.material_curve_p1 || [];

  renderHeader(data);
  renderStoryHighlights(data, story, viewSlot);
  renderMaterialCurve(curveP1, story.turning_point, viewSlot);
  renderInfoEdge(story.info_edge_curve, viewSlot);
  renderCompositionalKnowledge(story.compositional_knowledge_curve, viewSlot);
  renderPhaseStats(story.phase_stats, viewSlot);
  renderPieceCareers(story.piece_careers || [], viewSlot);
  renderTerritory(story.territory_timeline || []);
}

function slotLabel(slot, data) {
  return slot === 1 ? data.player1_username : data.player2_username;
}

function renderHeader(data) {
  const winner = data.winner_slot ? slotLabel(data.winner_slot, data) : "Draw";
  const el = document.getElementById("game-header");
  el.innerHTML = `
    <h2>${data.player1_username} vs ${data.player2_username}</h2>
    <p class="game-detail-subtitle" data-tooltip="Rated human game — stats computed at game end">
      ${winner === "Draw" ? "Draw" : `${winner} wins`} · ${data.turn_number ?? "—"} moves · ${new Date(data.created_at).toLocaleString()}
    </p>
    <p class="game-detail-view-toggle">
      Viewing as:
      <a href="?id=${gameId}&slot=1" class="${viewSlot === 1 ? "active" : ""}">${data.player1_username}</a>
      ·
      <a href="?id=${gameId}&slot=2" class="${viewSlot === 2 ? "active" : ""}">${data.player2_username}</a>
    </p>
  `;
}

function renderStoryHighlights(data, story, slot) {
  const el = document.getElementById("game-story");
  const highlights = [];
  const name = slotLabel(slot, data);
  const careers = (story.piece_careers || []).filter((p) => p.player_slot === slot);
  const enemyCareers = (story.piece_careers || []).filter((p) => p.player_slot !== slot);

  const mvp = [...careers].sort((a, b) => b.kills - a.kills)[0];
  if (mvp?.kills > 0) {
    highlights.push({
      icon: "⭐",
      text: `${name}'s MVP: ${RANK_NAME[mvp.rank] || "?"} — ${mvp.kills} kills, ${mvp.moves_made} moves`,
      tooltip: "Your piece with the most kills this game",
    });
  }

  const deadliestEnemy = [...enemyCareers].sort((a, b) => b.kills - a.kills)[0];
  if (deadliestEnemy?.kills > 0) {
    highlights.push({
      icon: "💀",
      text: `Most dangerous enemy: ${RANK_NAME[deadliestEnemy.rank] || "?"} killed ${deadliestEnemy.kills} of yours`,
      tooltip: "Enemy piece that eliminated the most of your army",
    });
  }

  const kc = story.kill_chains?.[`slot${slot}`];
  if (kc?.length >= 3) {
    highlights.push({
      icon: "🔥",
      text: `${name} went on a ${kc.length}-kill streak (moves ${kc.start_move}–${kc.end_move})`,
      tooltip: "Longest streak of consecutive combat wins without the opponent getting a kill",
    });
  }

  if (story.turning_point) {
    highlights.push({
      icon: "📈",
      text: `Turning point at combat #${story.turning_point.combat_index + 1} (move ${story.turning_point.move_number}) — material lead never changed after`,
      tooltip: "Last combat where rank-value advantage permanently flipped",
    });
  }

  const fp = story.flag_proximity?.[`slot${slot}`];
  if (fp !== null && fp !== undefined && fp <= 5) {
    highlights.push({
      icon: "🚩",
      text: `Enemy got within ${fp} square${fp === 1 ? "" : "s"} of your Flag`,
      tooltip: "Minimum Manhattan distance from any enemy move destination to your Flag's board coordinates",
    });
  }

  const fc = story.first_casualty;
  if (fc) {
    highlights.push({
      icon: "🩸",
      text: `First blood: ${RANK_NAME[fc.killed_by_rank] || "?"} killed ${slotLabel(fc.player_slot, data)}'s ${RANK_NAME[fc.rank] || "?"} at move ${fc.move_number}`,
      tooltip: "First piece eliminated in combat",
    });
  }

  const tt = story.think_times;
  const avgKey = slot === 1 ? "p1_avg_ms" : "p2_avg_ms";
  const maxKey = slot === 1 ? "p1_max_ms" : "p2_max_ms";
  if (tt?.[avgKey]) {
    highlights.push({
      icon: "⏱️",
      text: `${name} avg think time: ${(tt[avgKey] / 1000).toFixed(1)}s (max ${(tt[maxKey] / 1000).toFixed(0)}s)`,
      tooltip: "Time between consecutive moves (capped at 10 min — overnight gaps ignored)",
    });
  }

  el.innerHTML = `
    <h3>Story Highlights <span class="stat-help" data-tooltip="Key narrative beats from this game — MVP, kill chains, turning points, flag pressure, tempo">?</span></h3>
    <div class="story-highlights">
      ${highlights.map((h) => `
        <div class="highlight-item">
          <span class="highlight-icon">${h.icon}</span>
          <span class="highlight-text">${h.text}</span>
          <span class="stat-help" data-tooltip="${h.tooltip}">?</span>
        </div>
      `).join("") || "<p class=\"muted\">No highlights for this perspective.</p>"}
    </div>
  `;
}

/**
 * Line chart with y-axis labels (+max / min), matching gameSummary.js sparkline convention.
 */
function renderLineChart(elId, title, tooltip, series, markerIndex) {
  const el = document.getElementById(elId);
  if (!series?.length) return;
  const w = 520;
  const h = 150;
  const pad = 16;
  const labelPad = 36;
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;
  const yPos = (v) => pad + (1 - (v - min) / range) * (h - 2 * pad);
  const xPos = (i) => labelPad + (i / Math.max(series.length - 1, 1)) * (w - labelPad - pad);
  const points = series.map((v, i) => `${xPos(i)},${yPos(v)}`).join(" ");
  const zeroY = yPos(0);
  const topLabel = max > 0 ? `+${max}` : `${max}`;
  const botLabel = `${min}`;
  let marker = "";
  if (markerIndex != null && markerIndex >= 0 && markerIndex < series.length) {
    const mx = xPos(markerIndex);
    marker = `<line x1="${mx}" y1="${pad}" x2="${mx}" y2="${h - pad}" stroke="rgba(255,200,50,0.7)" stroke-width="1" stroke-dasharray="3,3"/>`;
  }
  el.innerHTML = `
    <h3>${title} <span class="stat-help" data-tooltip="${tooltip}">?</span></h3>
    <svg viewBox="0 0 ${w} ${h}" class="detail-curve">
      <text x="2" y="${pad + 4}" font-size="10" fill="rgba(255,255,255,0.45)">${topLabel}</text>
      <text x="2" y="${h - pad + 2}" font-size="10" fill="rgba(255,255,255,0.45)">${botLabel}</text>
      <line x1="${labelPad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5" stroke-dasharray="3,3"/>
      <polyline points="${points}" fill="none" stroke="rgba(100,200,150,0.9)" stroke-width="2" stroke-linejoin="round"/>
      ${marker}
    </svg>
  `;
}

function renderMaterialCurve(curveP1, turningPoint, slot) {
  const curve = slot === 1 ? curveP1 : curveP1.map((v) => -v);
  renderLineChart(
    "game-material-curve",
    "Material Curve",
    "Rank-value advantage after each combat. Above zero = you are ahead. Y-axis shows peak and trough.",
    curve,
    turningPoint?.combat_index ?? null,
  );
}

function renderInfoEdge(infoEdge, slot) {
  const series = infoEdge?.[`slot${slot}`] || [];
  renderLineChart(
    "game-info-edge",
    "Information Edge",
    "Asymmetric knowledge advantage after each combat: Scout inferences + elimination deductions you hold minus those the enemy holds. Pure combat reveals are symmetric and do not move this curve.",
    series,
    null,
  );
}

function renderCompositionalKnowledge(compositionalKnowledge, slot) {
  const series = compositionalKnowledge?.[`slot${slot}`] || [];
  renderLineChart(
    "game-compositional-knowledge",
    "Compositional Knowledge",
    "How much you can deduce about remaining enemy pieces from what you've already eliminated — rises as you kill more",
    series,
    null,
  );
}

function pct(num, den) {
  return den > 0 ? `${((num / den) * 100).toFixed(0)}%` : "—";
}

function renderPhaseStats(phaseStats, slot) {
  const el = document.getElementById("game-phase-stats");
  const ps = phaseStats?.[`slot${slot}`];
  if (!ps) return;
  const rows = ["q1", "q2", "q3", "q4"].map((q) => {
    const b = ps.by_capture_quarter[q];
    return `<tr>
      <td>${q.toUpperCase()}</td>
      <td>${pct(b.reveal_wins, b.reveal_attacks)}</td>
      <td>${b.trade_count ? (b.trade_sum / b.trade_count).toFixed(1) : "—"}</td>
      <td>${pct(b.attack_wins, b.attacks)}</td>
      <td>${pct(b.avenge_kills, b.avenge_opportunities)}</td>
      <td>${b.attacks}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `
    <h3>Phase Breakdown <span class="stat-help" data-tooltip="Metrics binned by capture quartile — Q1 is opening fog, Q4 is endgame. Captures = attack kills + defense kills. Attack WR only counts combats you initiated. Avenge = kill a piece that previously killed yours.">?</span></h3>
    <table class="history-table phase-table">
      <thead><tr><th>Phase</th><th>Reveal Eff</th><th>Trade Eff</th><th>Attack WR</th><th>Avenge</th><th>Attacks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderPieceCareers(careers, slot) {
  const el = document.getElementById("game-pieces");
  const notable = careers
    .filter((p) => p.player_slot === slot && (p.kills > 0 || p.moves_made >= 10))
    .sort((a, b) => b.kills - a.kills || b.moves_made - a.moves_made);
  if (!notable.length) return;
  el.innerHTML = `
    <h3>Piece Careers <span class="stat-help" data-tooltip="Notable pieces — kills > 0 or 10+ moves. All 80 pieces tracked; only standouts shown.">?</span></h3>
    <table class="history-table piece-career-table">
      <thead><tr><th>Piece</th><th>Kills</th><th>Moves</th><th>Distance</th><th>Status</th></tr></thead>
      <tbody>
        ${notable.slice(0, 12).map((p) => `
          <tr>
            <td>${RANK_NAME[p.rank] || p.rank}</td>
            <td>${p.kills}</td>
            <td>${p.moves_made}</td>
            <td>${p.distance} sq</td>
            <td>${p.alive ? "Survived" : `Died move ${p.death_move}`}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderTerritory(timeline) {
  if (!timeline || timeline.length < 2) return;
  const el = document.getElementById("game-territory");
  const w = 520;
  const h = 110;
  const pad = 16;
  const labelPad = 28;
  const maxPieces = Math.max(
    ...timeline.map((t) => Math.max(t.p1_in_enemy, t.p2_in_enemy)),
    1,
  );
  const yPos = (v) => pad + (1 - v / maxPieces) * (h - 2 * pad);
  const xPos = (i) => labelPad + (i / Math.max(timeline.length - 1, 1)) * (w - labelPad - pad);
  const p1 = timeline.map((t, i) => `${xPos(i)},${yPos(t.p1_in_enemy)}`).join(" ");
  const p2 = timeline.map((t, i) => `${xPos(i)},${yPos(t.p2_in_enemy)}`).join(" ");
  el.innerHTML = `
    <h3>Territory Control <span class="stat-help" data-tooltip="Alive pieces in enemy half sampled every 20 moves (alive-at-sample-time, not final state). Shows invasion pressure over time.">?</span></h3>
    <svg viewBox="0 0 ${w} ${h}" class="detail-curve">
      <text x="2" y="${pad + 4}" font-size="9" fill="rgba(255,255,255,0.45)">${maxPieces}</text>
      <text x="2" y="${h - pad + 2}" font-size="9" fill="rgba(255,255,255,0.45)">0</text>
      <polyline points="${p1}" fill="none" stroke="rgba(100,200,150,0.85)" stroke-width="1.5"/>
      <polyline points="${p2}" fill="none" stroke="rgba(200,100,100,0.85)" stroke-width="1.5"/>
      <text x="${w - pad}" y="${pad}" font-size="8" fill="rgba(100,200,150,0.8)" text-anchor="end">P1 in enemy half</text>
      <text x="${w - pad}" y="${pad + 12}" font-size="8" fill="rgba(200,100,100,0.8)" text-anchor="end">P2 in enemy half</text>
    </svg>
  `;
}
