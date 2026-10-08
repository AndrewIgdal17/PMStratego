import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ColorPicker, PLAYER_COLORS } from '../components/ColorPicker.tsx';
import { FormationControls } from '../components/FormationControls.tsx';
import { PieceSidebar } from '../components/PieceSidebar.tsx';
import { SegmentedChoice } from '../components/SegmentedChoice.tsx';
import { SetupGrid } from '../components/SetupGrid.tsx';
import { SubmitControls } from '../components/SubmitControls.tsx';
import { AGGRESSIVE_FORMATIONS, DEFENSIVE_FORMATIONS } from '../data/formations.ts';
import { useSetupChannel } from '../hooks/useSetupChannel.ts';
import { getPlayerColor, getRoomSession, saveRoomSession, setPlayerColor } from '../lib/roomSession.ts';
import {
  COUNTDOWN_SECONDS,
  LOCAL_ROWS,
  SETUP_COLS,
  cellKey,
  remainingByRank,
  toAbsolutePlacements,
} from '../lib/setupPlacement.ts';
import { callFunction, supabase } from '../lib/supabaseClient.ts';
import { ARMY_COMPOSITION, ARMY_SIZE } from '../rules/pieces.ts';
import type { Difficulty, Formation, Personality, Slot } from '../types.ts';

const MISSING_TOKEN =
  'No access token found for this room. Use the link your friend sent you, or create a new game from the home page.';

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

const PERSONALITY_OPTIONS: { value: Personality; label: string }[] = [
  { value: 'aggressive', label: 'Aggressive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'defensive', label: 'Defensive' },
];

interface Seat {
  token: string;
  slot: Slot;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'UNKNOWN_ERROR';
}

function randomPlacements(): Map<string, string> {
  const squares: string[] = [];
  for (const row of LOCAL_ROWS) {
    for (const col of SETUP_COLS) squares.push(cellKey(row, col));
  }
  const ranks = ARMY_COMPOSITION.flatMap((entry) => Array<string>(entry.count).fill(String(entry.rank)));
  for (let i = ranks.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const left = ranks[i];
    const right = ranks[j];
    if (left === undefined || right === undefined) continue;
    ranks[i] = right;
    ranks[j] = left;
  }
  const next = new Map<string, string>();
  squares.forEach((key, index) => {
    const rank = ranks[index];
    if (rank !== undefined) next.set(key, rank);
  });
  return next;
}

function placementsFromFormation(formation: Formation): Map<string, string> {
  const next = new Map<string, string>();
  for (const [row, col, rank] of formation.cells) {
    next.set(cellKey(row, col), rank);
  }
  return next;
}

export function SetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomCode = params.get('code');
  const isJoining = params.get('join') === '1';

  const [session, setSession] = useState<Seat | null>(() =>
    roomCode ? getRoomSession(roomCode) : null,
  );
  const [sessionError, setSessionError] = useState<string | null>(() => {
    if (!roomCode) return MISSING_TOKEN;
    if (getRoomSession(roomCode)) return null;
    if (isJoining) return null;
    return MISSING_TOKEN;
  });

  const [placements, setPlacements] = useState<Map<string, string>>(() => new Map());
  const [selectedRank, setSelectedRank] = useState<string | null>(null);
  const [formationLabel, setFormationLabel] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [listening, setListening] = useState(false);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isBotGame, setIsBotGame] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [personality, setPersonality] = useState<Personality>('neutral');
  const [color, setColor] = useState(() =>
    roomCode ? getPlayerColor(roomCode) : PLAYER_COLORS[0].hex,
  );

  const submitLock = useRef(false);
  const formationIndex = useRef({ defensive: -1, aggressive: -1 });
  const countdownEndsAtRef = useRef<number | null>(null);
  const startSent = useRef(false);

  useEffect(() => {
    if (!roomCode) return;
    const stored = localStorage.getItem(`stratego:${roomCode}:color`);
    if (!stored) {
      setPlayerColor(roomCode, PLAYER_COLORS[0].hex);
      setColor(PLAYER_COLORS[0].hex);
    }
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode || session) return;
    if (!isJoining) return;
    let cancelled = false;
    void callFunction('join-game', { roomCode })
      .then((result) => {
        saveRoomSession(roomCode, result.token, 2);
        if (!cancelled) setSession({ token: result.token, slot: 2 });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const existing = getRoomSession(roomCode);
        if (existing) {
          setSession(existing);
          return;
        }
        setSessionError(`Could not join this game: ${errorText(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [roomCode, session, isJoining]);

  useEffect(() => {
    if (!roomCode || !session) return;
    const slot = session.slot;
    const code = roomCode;
    let cancelled = false;
    async function loadGame(): Promise<void> {
      const { data } = await supabase
        .from('games')
        .select('is_bot_game, bot_difficulty, bot_personality')
        .eq('room_code', code)
        .single();
      if (cancelled || !data) return;
      const row = data as {
        is_bot_game?: boolean;
        bot_difficulty?: Difficulty | null;
        bot_personality?: Personality | null;
      };
      if (!row.is_bot_game || slot !== 1) return;
      setIsBotGame(true);
      setDifficulty(row.bot_difficulty ?? 'medium');
      setPersonality(row.bot_personality ?? 'neutral');
    }
    void loadGame();
    return () => {
      cancelled = true;
    };
  }, [roomCode, session]);

  useEffect(() => {
    if (!selectedRank) return;
    if ((remainingByRank(placements).get(selectedRank) ?? 0) <= 0) setSelectedRank(null);
  }, [placements, selectedRank]);

  useEffect(() => {
    if (countdownEndsAt == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [countdownEndsAt]);

  useEffect(() => {
    if (countdownEndsAt == null || !session || !roomCode) return;
    const delay = Math.max(0, countdownEndsAt - Date.now());
    const timer = window.setTimeout(() => {
      if (startSent.current) return;
      startSent.current = true;
      setStarting(true);
      void callFunction('start-game', { token: session.token }).then(
        () => {
          navigate(`/game?code=${roomCode}`);
        },
        () => {
          navigate(`/game?code=${roomCode}`);
        },
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [countdownEndsAt, session, roomCode, navigate]);

  function beginCountdown(bothSubmittedAt: string): void {
    if (countdownEndsAtRef.current != null) return;
    const endsAt = new Date(bothSubmittedAt).getTime() + COUNTDOWN_SECONDS * 1000;
    countdownEndsAtRef.current = endsAt;
    startSent.current = false;
    setNow(Date.now());
    setStarting(false);
    setCountdownEndsAt(endsAt);
    setStatus('Both players ready!');
  }

  function clearCountdown(): void {
    countdownEndsAtRef.current = null;
    startSent.current = false;
    setCountdownEndsAt(null);
    setStarting(false);
  }

  useSetupChannel(roomCode, listening, {
    onActive: () => {
      if (roomCode) navigate(`/game?code=${roomCode}`);
    },
    onBothSubmitted: (bothSubmittedAt) => {
      beginCountdown(bothSubmittedAt);
    },
    onCountdownCleared: () => {
      if (countdownEndsAtRef.current == null) return;
      clearCountdown();
      setStatus('Opponent is rearranging... waiting for them to resubmit.');
    },
  });

  function handleCell(localRow: number, localCol: number): void {
    if (submitted) return;
    const key = cellKey(localRow, localCol);
    setPlacements((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      if (!selectedRank) return prev;
      if ((remainingByRank(prev).get(selectedRank) ?? 0) <= 0) return prev;
      next.set(key, selectedRank);
      return next;
    });
  }

  function applyCatalog(name: 'defensive' | 'aggressive'): void {
    if (submitted) return;
    const catalog = name === 'defensive' ? DEFENSIVE_FORMATIONS : AGGRESSIVE_FORMATIONS;
    const nextIndex = (formationIndex.current[name] + 1) % catalog.length;
    const formation = catalog[nextIndex];
    if (!formation) return;
    formationIndex.current = { ...formationIndex.current, [name]: nextIndex };
    setPlacements(placementsFromFormation(formation));
    setFormationLabel(`${formation.name} (${nextIndex + 1}/${catalog.length})`);
  }

  function handleRandom(): void {
    if (submitted) return;
    setPlacements(randomPlacements());
    setFormationLabel('');
  }

  function handleClear(): void {
    if (submitted) return;
    setPlacements(new Map());
  }

  function enterWaiting(countdownAt: string | null): void {
    setSubmitted(true);
    setSubmitting(false);
    setListening(true);
    if (countdownAt) beginCountdown(countdownAt);
    else setStatus('Setup submitted. Waiting for your opponent...');
  }

  async function handleSubmit(): Promise<void> {
    if (!session || !roomCode || submitted || submitLock.current) return;
    if (placements.size !== ARMY_SIZE) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const result = await callFunction('submit-setup', {
        token: session.token,
        placements: toAbsolutePlacements(placements, session.slot),
      });
      if (result.gameStarted) {
        setStatus('Both players ready! Loading game...');
        navigate(`/game?code=${roomCode}`);
        return;
      }
      enterWaiting(result.countdownStarted ? new Date().toISOString() : null);
    } catch (err) {
      const message = errorText(err);
      if (message === 'SETUP_ALREADY_SUBMITTED') {
        enterWaiting(null);
        return;
      }
      submitLock.current = false;
      setSubmitting(false);
      setStatus(`Setup failed: ${message}`);
    }
  }

  async function handleUnsubmit(): Promise<void> {
    if (!session) return;
    try {
      await callFunction('unsubmit-setup', { token: session.token });
      setPlacements(new Map());
      setSubmitted(false);
      setListening(false);
      submitLock.current = false;
      clearCountdown();
      setStatus('Setup unsubmitted. Rearrange your army and resubmit.');
    } catch (err) {
      setStatus(`Unsubmit failed: ${errorText(err)}`);
    }
  }

  async function handleDifficulty(next: Difficulty): Promise<void> {
    if (!session) return;
    try {
      await callFunction('set-bot-difficulty', { token: session.token, difficulty: next });
      setDifficulty(next);
    } catch (err) {
      setStatus(`Failed to set difficulty: ${errorText(err)}`);
    }
  }

  async function handlePersonality(next: Personality): Promise<void> {
    if (!session) return;
    try {
      await callFunction('set-bot-personality', { token: session.token, personality: next });
      setPersonality(next);
    } catch (err) {
      setStatus(`Failed to set personality: ${errorText(err)}`);
    }
  }

  function handleColor(hex: string): void {
    if (!roomCode) return;
    setPlayerColor(roomCode, hex);
    setColor(hex);
  }

  if (sessionError) {
    return (
      <div className="page-shell setup">
        <main className="page-frame">
          <p>{sessionError}</p>
        </main>
      </div>
    );
  }

  if (!session || !roomCode) {
    return (
      <div className="page-shell setup">
        <main className="page-frame">
          <p>Joining game…</p>
        </main>
      </div>
    );
  }

  const remaining = remainingByRank(placements);
  const countdownSeconds =
    countdownEndsAt == null ? null : Math.max(0, Math.ceil((countdownEndsAt - now) / 1000));
  const showBotControls = isBotGame && session.slot === 1;

  return (
    <div className="page-shell setup">
      <main className="page-frame">
        <h1>Arrange your army</h1>
        <div className="setup-layout">
          <PieceSidebar remaining={remaining} selectedRank={selectedRank} onSelect={setSelectedRank} />
          <div className="setup-main">
            <ColorPicker value={color} onChange={handleColor} />
            <FormationControls
              disabled={submitted}
              onRandom={handleRandom}
              onDefensive={() => applyCatalog('defensive')}
              onAggressive={() => applyCatalog('aggressive')}
              onClear={handleClear}
            />
            {showBotControls ? (
              <>
                <div className="setup-controls">
                  <span className="difficulty-label">Bot difficulty:</span>
                  <SegmentedChoice
                    options={DIFFICULTY_OPTIONS}
                    value={difficulty}
                    onChange={(value) => {
                      void handleDifficulty(value);
                    }}
                  />
                </div>
                <div className="setup-controls">
                  <span className="difficulty-label">Bot personality:</span>
                  <SegmentedChoice
                    options={PERSONALITY_OPTIONS}
                    value={personality}
                    onChange={(value) => {
                      void handlePersonality(value);
                    }}
                  />
                </div>
              </>
            ) : null}
            <SetupGrid
              placements={placements}
              color={color}
              slot={session.slot}
              locked={submitted}
              formationLabel={formationLabel}
              onCell={handleCell}
            />
            <SubmitControls
              placed={placements.size}
              submitted={submitted}
              submitting={submitting}
              countdownSeconds={countdownSeconds}
              starting={starting}
              status={status}
              onSubmit={() => {
                void handleSubmit();
              }}
              onUnsubmit={() => {
                void handleUnsubmit();
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
