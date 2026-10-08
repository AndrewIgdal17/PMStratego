import {
  ACHIEVEMENTS,
  achievementHint,
  type Achievement,
  type PlayerStats,
} from '../lib/profileStats.ts';

interface AchievementsGridProps {
  achievements: Achievement[];
  stats: PlayerStats | null;
}

export function AchievementsGrid({ achievements, stats }: AchievementsGridProps) {
  const unlocked = new Set(achievements.map((entry) => entry.achievement_key));

  return (
    <>
      <h3>Achievements</h3>
      <div className="achievements-grid">
        {ACHIEVEMENTS.map((achievement) => {
          const isUnlocked = unlocked.has(achievement.key);
          const hint = achievementHint(achievement.key, stats, isUnlocked);
          return (
            <div
              key={achievement.key}
              className={`achievement-item ${isUnlocked ? 'unlocked' : 'locked'}`}
            >
              <span className="achievement-name">{achievement.name}</span>
              <span className="stat-help" data-tooltip={achievement.desc}>
                ?
              </span>
              {hint ? <span className="achievement-progress">{hint}</span> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
