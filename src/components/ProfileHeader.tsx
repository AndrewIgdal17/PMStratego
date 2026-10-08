import { formatArchetype, formatInfoArchetype, type Player, type PlayerStats } from '../lib/profileStats.ts';

interface ProfileHeaderProps {
  player: Player;
  stats: PlayerStats | null;
}

export function ProfileHeader({ player, stats }: ProfileHeaderProps) {
  const totalGames = stats ? stats.wins + stats.losses + stats.draws : 0;
  const winRate = totalGames > 0 && stats ? ((stats.wins / totalGames) * 100).toFixed(1) : '0.0';

  return (
    <>
      <h2>{player.username}</h2>
      <div className="profile-meta">
        <span className={`rating-badge${player.rating_provisional ? ' provisional' : ''}`}>
          {player.rating}
          {player.rating_provisional ? ' (Provisional)' : ''}
        </span>
        {stats?.archetype ? (
          <span
            className="archetype-badge"
            data-tooltip="Playstyle archetype — recalculated every 5 games based on your stat pattern"
          >
            {formatArchetype(stats.archetype)}
          </span>
        ) : null}
        {stats?.info_archetype ? (
          <span
            className="archetype-badge info-archetype-badge"
            data-tooltip="Information Warfare archetype — how you hide, reveal, and convert knowledge"
          >
            {formatInfoArchetype(stats.info_archetype)}
          </span>
        ) : null}
        <span>{player.games_played} games</span>
        <span>{winRate}% win rate</span>
        <span>Member since {new Date(player.created_at).toLocaleDateString()}</span>
      </div>
    </>
  );
}
