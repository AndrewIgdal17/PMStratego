import {
  buildStatSections,
  memoryPhasePercent,
  phaseBreakdownVisible,
  scoutingTagText,
  type PhaseCareer,
  type PlayerStats,
} from '../lib/profileStats.ts';

interface StatsSectionsProps {
  stats: PlayerStats;
}

export function ScoutingTags({ tags }: { tags: string[] | undefined }) {
  if (!tags?.length) return null;
  return (
    <div className="scouting-tags">
      {tags.map((tag, index) => (
        <span key={`${tag}-${index}`} className="scouting-tag">
          {scoutingTagText(tag)}
        </span>
      ))}
    </div>
  );
}

export function PhaseBreakdown({ career }: { career: PhaseCareer | null }) {
  if (!phaseBreakdownVisible(career) || !career?.by_material_state) return null;
  const mat = career.by_material_state;
  const cap = career.by_capture_quarter;
  const info = career.by_info_state;

  return (
    <div className="phase-breakdown">
      <div className="phase-lens">
        <span
          className="phase-lens-title"
          data-tooltip="Memory accuracy broken down by your material position when the memory test happened"
        >
          By Position:
        </span>
        <span className="phase-pill phase-behind">Behind {memoryPhasePercent(mat.behind)}</span>
        <span className="phase-pill phase-even">Even {memoryPhasePercent(mat.even)}</span>
        <span className="phase-pill phase-ahead">Ahead {memoryPhasePercent(mat.ahead)}</span>
        <span className="phase-pill phase-dominant">Dominant {memoryPhasePercent(mat.dominant)}</span>
      </div>
      {cap ? (
        <div className="phase-lens">
          <span
            className="phase-lens-title"
            data-tooltip="Memory accuracy by game progress (quartiles of your total captures)"
          >
            By Progress:
          </span>
          <span className="phase-pill">Q1 {memoryPhasePercent(cap.q1)}</span>
          <span className="phase-pill">Q2 {memoryPhasePercent(cap.q2)}</span>
          <span className="phase-pill">Q3 {memoryPhasePercent(cap.q3)}</span>
          <span className="phase-pill">Q4 {memoryPhasePercent(cap.q4)}</span>
        </div>
      ) : null}
      {info ? (
        <div className="phase-lens">
          <span
            className="phase-lens-title"
            data-tooltip="Memory accuracy by how much of the enemy army you'd already mapped"
          >
            By Fog:
          </span>
          <span className="phase-pill">Deep Fog {memoryPhasePercent(info.deep_fog)}</span>
          <span className="phase-pill">Partial {memoryPhasePercent(info.partial)}</span>
          <span className="phase-pill">Known {memoryPhasePercent(info.known)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function StatsSections({ stats }: StatsSectionsProps) {
  const sections = buildStatSections(stats);

  return (
    <>
      {sections.map((section) => (
        <details key={section.title} className="stats-section" open>
          <summary>{section.title}</summary>
          <div className="stats-grid">
            {section.items.map((stat) => (
              <div key={stat.label} className="stat-item">
                <span className="stat-label">
                  {stat.label}{' '}
                  <span className="stat-help" data-tooltip={stat.tooltip}>
                    ?
                  </span>
                </span>
                <span className="stat-value">
                  {stat.insufficientMemory ? (
                    <span data-tooltip="Need 5+ memory tests to display">{stat.value}</span>
                  ) : (
                    stat.value
                  )}
                </span>
              </div>
            ))}
          </div>
          {section.extra === 'memory' ? (
            <>
              <ScoutingTags tags={stats.memory_scouting?.tags} />
              <PhaseBreakdown career={stats.phase_career} />
            </>
          ) : null}
        </details>
      ))}
    </>
  );
}
