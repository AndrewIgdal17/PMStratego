import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { pickBotFormationPlacements } from '../bot/bot.ts';
import {
  Leaderboard,
  type LeaderboardCategory,
  type MicroLeaderboardRow,
  type RatingLeaderboardRow,
} from '../components/Leaderboard.tsx';
import { callFunction, supabase } from '../lib/supabaseClient.ts';
import { clearRoomSession, getRoomSession, saveBotToken, saveRoomSession } from '../lib/roomSession.ts';

type CopiedField = 'link' | 'code';

interface CreateResult {
  roomCode: string;
  inviteUrl: string;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'UNKNOWN_ERROR';
}

function inviteUrlFor(roomCode: string): string {
  return `${window.location.origin}/setup?code=${roomCode}&join=1`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function readRatingRows(data: unknown): RatingLeaderboardRow[] {
  if (!Array.isArray(data)) return [];
  const rows: RatingLeaderboardRow[] = [];
  for (const item of data) {
    const row = readRecord(item);
    if (!row || typeof row.username !== 'string') continue;
    rows.push({
      username: row.username,
      rating: scalar(row.rating),
      wins: scalar(row.wins),
      losses: scalar(row.losses),
      winRate: scalar(row.win_rate),
      longestStreak: scalar(row.longest_streak),
    });
  }
  return rows;
}

function readMicroRows(data: unknown): MicroLeaderboardRow[] {
  if (!Array.isArray(data)) return [];
  const rows: MicroLeaderboardRow[] = [];
  for (const item of data) {
    const row = readRecord(item);
    if (!row || typeof row.username !== 'string') continue;
    rows.push({ username: row.username, value: scalar(row.value) });
  }
  return rows;
}

function scalar(value: unknown): number | string {
  if (typeof value === 'number' || typeof value === 'string') return value;
  return '';
}

export function HomePage() {
  const navigate = useNavigate();
  const createLock = useRef(false);
  const joinLock = useRef(false);
  const botLock = useRef(false);
  const copyTimer = useRef<number | null>(null);

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState<CopiedField | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [botBusy, setBotBusy] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);

  const [spectateCode, setSpectateCode] = useState('');

  const [category, setCategory] = useState<LeaderboardCategory>('rating');
  const [ratingRows, setRatingRows] = useState<RatingLeaderboardRow[]>([]);
  const [microRows, setMicroRows] = useState<MicroLeaderboardRow[]>([]);
  const [leaderboardEmpty, setLeaderboardEmpty] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLeaderboardLoading(true);
    setLeaderboardEmpty(false);
    if (category === 'rating') setRatingRows([]);
    else setMicroRows([]);

    async function load(): Promise<void> {
      try {
        if (category === 'rating') {
          const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: 10, p_offset: 0 });
          if (cancelled) return;
          const rows = !error ? readRatingRows(data) : [];
          setRatingRows(rows);
          setLeaderboardEmpty(rows.length === 0);
          return;
        }

        const { data, error } = await supabase.rpc('get_micro_leaderboard', {
          p_category: category,
          p_limit: 10,
        });
        if (cancelled) return;
        const rows = !error ? readMicroRows(data) : [];
        setMicroRows(rows);
        setLeaderboardEmpty(rows.length === 0);
      } catch {
        if (cancelled) return;
        if (category === 'rating') setRatingRows([]);
        else setMicroRows([]);
        setLeaderboardEmpty(true);
      } finally {
        if (!cancelled) setLeaderboardLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [category]);

  async function handleCreate(): Promise<void> {
    if (createLock.current) return;
    createLock.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const { roomCode, token } = await callFunction('create-game', {});
      saveRoomSession(roomCode, token, 1);
      setCreateResult({ roomCode, inviteUrl: inviteUrlFor(roomCode) });
      setCreated(true);
    } catch (err) {
      createLock.current = false;
      setCreateError(`Failed to create game: ${errorText(err)}`);
    } finally {
      setCreating(false);
    }
  }

  async function copyField(field: CopiedField, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(field);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopied(null);
      copyTimer.current = null;
    }, 1500);
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (joinLock.current) return;
    const roomCode = joinCode.trim().toUpperCase();
    if (!roomCode) return;
    joinLock.current = true;
    setJoining(true);
    setJoinError(null);
    try {
      const { token } = await callFunction('join-game', { roomCode });
      saveRoomSession(roomCode, token, 2);
      navigate(`/setup?code=${roomCode}`);
    } catch (err) {
      joinLock.current = false;
      setJoinError(`Could not join: ${errorText(err)}`);
      setJoining(false);
    }
  }

  async function handlePlayBot(): Promise<void> {
    if (botLock.current) return;
    botLock.current = true;
    setBotBusy(true);
    setBotError(null);
    let roomCode: string | null = null;
    try {
      const createdGame = await callFunction('create-game', { isBotGame: true });
      roomCode = createdGame.roomCode;
      saveRoomSession(roomCode, createdGame.token, 1);

      const joined = await callFunction('join-game', { roomCode });
      saveBotToken(roomCode, joined.token);
      const placements = pickBotFormationPlacements();
      await callFunction('submit-setup', { token: joined.token, placements });

      navigate(`/setup?code=${roomCode}`);
    } catch (err) {
      if (roomCode) {
        const humanToken = getRoomSession(roomCode)?.token;
        if (humanToken) {
          try {
            await callFunction('abandon-game', { token: humanToken });
          } catch {
            // best effort
          }
        }
        clearRoomSession(roomCode);
      }
      setBotError(`Failed to start bot game: ${errorText(err)}`);
      botLock.current = false;
      setBotBusy(false);
    }
  }

  function handleSpectate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const roomCode = spectateCode.trim().toUpperCase();
    if (!roomCode) return;
    navigate(`/game?code=${roomCode}&spectate=1`);
  }

  const showCreateResult = createResult !== null || createError !== null;

  return (
    <div className="page-shell home">
      <main className="page-frame">
        <section className="panel">
          <h2>Start a new game</h2>
          <button
            id="new-game-btn"
            type="button"
            className="btn-primary"
            disabled={creating || created}
            onClick={() => void handleCreate()}
          >
            {creating ? 'Creating...' : 'New Game'}
          </button>
          <div id="new-game-result" className="result" hidden={!showCreateResult}>
            {createError ? (
              createError
            ) : createResult ? (
              <>
                <p className="success-text">Room created!</p>
                <p className="room-code-label">Room code:</p>
                <div className="room-code-box">{createResult.roomCode}</div>
                <div className="copy-buttons">
                  <button
                    id="copy-link-btn"
                    type="button"
                    className="copy-btn"
                    onClick={() => void copyField('link', createResult.inviteUrl)}
                  >
                    {copied === 'link' ? 'Copied!' : 'Copy Link'}
                  </button>
                  <button
                    id="copy-code-btn"
                    type="button"
                    className="copy-btn"
                    onClick={() => void copyField('code', createResult.roomCode)}
                  >
                    {copied === 'code' ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
                <button
                  id="continue-to-setup-btn"
                  type="button"
                  className="btn-primary"
                  style={{ width: '100%', marginTop: '0.75rem' }}
                  onClick={() => navigate(`/setup?code=${createResult.roomCode}`)}
                >
                  Continue to setup
                </button>
              </>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <h2>Play vs Bot</h2>
          <p className="hint-text">Practice or bug-test alone — the bot plays legal moves automatically.</p>
          <button
            id="play-bot-btn"
            type="button"
            className="btn-primary"
            disabled={botBusy}
            onClick={() => void handlePlayBot()}
          >
            {botBusy ? 'Starting...' : 'Play vs Bot'}
          </button>
          <p id="play-bot-error" className="error" hidden={botError === null}>
            {botError}
          </p>
        </section>

        <section className="panel">
          <h2>Watch a game</h2>
          <p className="hint-text">Spectate a live game — see all pieces, both sides.</p>
          <form id="spectate-form" onSubmit={handleSpectate}>
            <input
              id="spectate-code-input"
              aria-label="Spectate room code"
              placeholder="Room code"
              maxLength={8}
              autoCapitalize="characters"
              required
              value={spectateCode}
              onChange={(event) => setSpectateCode(event.target.value.toUpperCase())}
            />
            <button type="submit">Spectate</button>
          </form>
        </section>

        <section className="panel">
          <h2>Join a game</h2>
          <form id="join-form" onSubmit={(event) => void handleJoin(event)}>
            <input
              id="room-code-input"
              aria-label="Join room code"
              placeholder="Room code"
              maxLength={8}
              autoCapitalize="characters"
              required
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            />
            <button type="submit" disabled={joining}>
              {joining ? 'Joining...' : 'Join'}
            </button>
          </form>
          <p id="join-error" className="error" hidden={joinError === null}>
            {joinError}
          </p>
        </section>

        <Leaderboard
          category={category}
          onCategory={setCategory}
          rows={category === 'rating' ? ratingRows : microRows}
          empty={leaderboardEmpty}
          loading={leaderboardLoading}
        />
      </main>
    </div>
  );
}
