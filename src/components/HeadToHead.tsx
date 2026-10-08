import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import type { HeadToHeadRecord } from '../lib/profileStats.ts';
import { supabase } from '../lib/supabaseClient.ts';

interface HeadToHeadProps {
  profilePlayerId: string;
  username: string;
}

function readRecord(data: unknown): HeadToHeadRecord | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Partial<HeadToHeadRecord>;
  if (typeof row.total_games !== 'number' || row.total_games === 0) return null;
  return {
    p1_wins: Number(row.p1_wins ?? 0),
    p2_wins: Number(row.p2_wins ?? 0),
    draws: Number(row.draws ?? 0),
    total_games: row.total_games,
    avg_moves: Number(row.avg_moves ?? 0),
  };
}

export function HeadToHead({ profilePlayerId, username }: HeadToHeadProps) {
  const { auth, isLoggedIn } = useAuth();
  const [record, setRecord] = useState<HeadToHeadRecord | null>(null);

  useEffect(() => {
    const myUsername = auth.username;
    if (!isLoggedIn || !myUsername || myUsername.toLowerCase() === username.toLowerCase()) {
      setRecord(null);
      return;
    }

    let cancelled = false;
    setRecord(null);
    void (async () => {
      const { data: myProfile } = await supabase.rpc('get_player_profile', { p_username: myUsername });
      const myId =
        myProfile && typeof myProfile === 'object' && 'player' in myProfile
          ? (myProfile.player as { id?: string } | null)?.id
          : undefined;
      if (!myId || cancelled) return;

      const { data } = await supabase.rpc('get_head_to_head', {
        p_player1_id: myId,
        p_player2_id: profilePlayerId,
      });
      if (cancelled) return;
      setRecord(readRecord(data));
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.username, isLoggedIn, profilePlayerId, username]);

  if (!record) return null;

  return (
    <div className="h2h-card">
      <div className="h2h-title">Head-to-Head vs {username}</div>
      <div className="h2h-record">
        <span className="h2h-wins">{record.p1_wins}W</span>
        <span className="h2h-draws">{record.draws}D</span>
        <span className="h2h-losses">{record.p2_wins}L</span>
      </div>
      <div className="h2h-meta">
        {record.total_games} games, avg {record.avg_moves} moves
      </div>
    </div>
  );
}
