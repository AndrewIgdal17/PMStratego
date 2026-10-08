import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AchievementsGrid } from '../components/AchievementsGrid.tsx';
import { CombatHeatmap } from '../components/CombatHeatmap.tsx';
import { GameHistory } from '../components/GameHistory.tsx';
import { HeadToHead } from '../components/HeadToHead.tsx';
import { PieceFate } from '../components/PieceFate.tsx';
import { ProfileHeader } from '../components/ProfileHeader.tsx';
import { RadarChart } from '../components/RadarChart.tsx';
import { StatsSections } from '../components/StatsSections.tsx';
import type { Achievement, Player, PlayerStats } from '../lib/profileStats.ts';
import { supabase } from '../lib/supabaseClient.ts';

interface ProfilePayload {
  player: Player;
  stats: PlayerStats | null;
  achievements: Achievement[];
}

function readProfile(data: unknown): ProfilePayload | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as { player?: Player; stats?: PlayerStats | null; achievements?: Achievement[] | null };
  if (!row.player || typeof row.player.username !== 'string' || typeof row.player.id !== 'string') return null;
  return {
    player: row.player,
    stats: row.stats ?? null,
    achievements: Array.isArray(row.achievements) ? row.achievements : [],
  };
}

export function ProfilePage() {
  const [params] = useSearchParams();
  const username = params.get('user');
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) {
      setProfile(null);
      setError('No username specified');
      return;
    }

    let cancelled = false;
    setProfile(null);
    setError(null);

    void (async () => {
      const { data, error: rpcError } = await supabase.rpc('get_player_profile', { p_username: username });
      if (cancelled) return;
      const next = !rpcError ? readProfile(data) : null;
      if (!next) {
        setError('Player not found');
        return;
      }
      setProfile(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [username]);

  useEffect(() => {
    if (!profile) return;
    const previous = document.title;
    document.title = `Stratego — ${profile.player.username}`;
    return () => {
      document.title = previous;
    };
  }, [profile]);

  return (
    <div className="page-shell profile">
      <main className="page-frame">
        {profile ? (
          <>
            <div id="profile-header" className="profile-header">
              <ProfileHeader player={profile.player} stats={profile.stats} />
            </div>
            <HeadToHead profilePlayerId={profile.player.id} username={profile.player.username} />
            <div id="profile-stats" className="profile-stats">
              <RadarChart stats={profile.stats} />
              {profile.stats ? <StatsSections stats={profile.stats} /> : null}
              {profile.stats ? <CombatHeatmap heatmap={profile.stats.attack_heatmap} /> : null}
              {profile.stats ? (
                <PieceFate
                  killsByRank={profile.stats.kills_by_rank}
                  deathsByRank={profile.stats.deaths_by_rank}
                />
              ) : null}
            </div>
            <div id="profile-achievements" className="profile-achievements">
              <AchievementsGrid achievements={profile.achievements} stats={profile.stats} />
            </div>
            <div id="profile-history" className="profile-history">
              <GameHistory username={profile.player.username} />
            </div>
          </>
        ) : null}
        {error ? (
          <p id="profile-error" className="error">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}
