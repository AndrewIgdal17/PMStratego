import { useEffect, useRef, useState, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AudioControls } from '../components/AudioControls.tsx';
import { Board } from '../components/Board.tsx';
import { ChatLog } from '../components/ChatLog.tsx';
import { GameActions } from '../components/GameActions.tsx';
import { GraveyardTray } from '../components/GraveyardTray.tsx';
import { MoveLog } from '../components/MoveLog.tsx';
import { RematchModal } from '../components/RematchModal.tsx';
import { TurnIndicator } from '../components/TurnIndicator.tsx';
import { useAudio, type SoundName } from '../hooks/useAudio.ts';
import { useGameState, type GameActions as GameState } from '../hooks/useGameState.ts';
import { inferEnemyDeadRanks } from '../lib/gameHelpers.ts';
import { getPlayerColor, getRoomSession } from '../lib/roomSession.ts';
import type { CombatResult, FogPiece, Square } from '../types.ts';

type PlaySound = (name: SoundName) => void;

const silent: PlaySound = () => {};

function combatSound(result: CombatResult): SoundName | null {
  if (!result) return 'move';
  if (String(result.defenderRank) === 'FLAG') return 'flagTaken';
  if (result.outcome === 'DEFENDER_WINS' && String(result.defenderRank) === 'BOMB') return 'bomb';
  if (result.outcome === 'ATTACKER_WINS') return 'attackWin';
  if (result.outcome === 'DEFENDER_WINS') return 'attackLose';
  if (result.outcome === 'TIE') return 'tie';
  return null;
}

function GameShell({ children }: { children: JSX.Element | string }): JSX.Element {
  return (
    <div className="page-shell game">
      <main className="page-frame">{typeof children === 'string' ? <p>{children}</p> : children}</main>
    </div>
  );
}

export function GamePage(): JSX.Element {
  const [params] = useSearchParams();
  const roomCode = params.get('code') ?? '';
  const isSpectator = params.get('spectate') === '1';
  const state = useGameState(roomCode, isSpectator);

  if (!roomCode) return <GameShell>Missing room code.</GameShell>;
  if (!isSpectator && !getRoomSession(roomCode)) {
    return <GameShell>No access token found for this room.</GameShell>;
  }
  if (isSpectator) {
    return <GameView roomCode={roomCode} isSpectator state={state} playSound={silent} showAudio={false} />;
  }
  return <SeatedGame roomCode={roomCode} state={state} />;
}

function SeatedGame({ roomCode, state }: { roomCode: string; state: GameState }): JSX.Element {
  const { playSound } = useAudio();
  return <GameView roomCode={roomCode} isSpectator={false} state={state} playSound={playSound} showAudio />;
}

interface GameViewProps {
  roomCode: string;
  isSpectator: boolean;
  state: GameState;
  playSound: PlaySound;
  showAudio: boolean;
}

function GameView({ roomCode, isSpectator, state, playSound, showAudio }: GameViewProps): JSX.Element {
  const navigate = useNavigate();
  const {
    gameRow,
    pieces,
    moves,
    chat,
    loading,
    error,
    mySlot,
    rematchCode,
    botError,
    submitMove,
    sendChat,
    resign,
    rematch,
    acceptRematch,
    dismissRematch,
  } = state;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const movingRef = useRef(false);
  const prevTurn = useRef<number | null>(null);

  const myTurn =
    !isSpectator && gameRow?.status === 'active' && gameRow.current_turn_slot === mySlot;

  useEffect(() => {
    if (!myTurn) setSelectedId(null);
  }, [myTurn]);

  useEffect(() => {
    if (isSpectator || !gameRow || gameRow.status === 'finished') return;
    const turn = gameRow.current_turn_slot;
    if (turn === mySlot && prevTurn.current !== mySlot && prevTurn.current !== null) {
      playSound('yourTurn');
    }
    prevTurn.current = turn;
  }, [gameRow, isSpectator, mySlot, playSound]);

  const pieceList = [...pieces.values()];
  const playerColor = getPlayerColor(roomCode);
  const notice = botError ?? (loading && !gameRow ? 'Loading game…' : null);

  function handleCell(row: number, col: number, piece: FogPiece | null): void {
    if (isSpectator || movingRef.current || !myTurn) return;
    if (selectedId) {
      if (piece?.is_mine) {
        setSelectedId(piece.piece_id);
        playSound('select');
        return;
      }
      const selected = pieces.get(selectedId);
      setSelectedId(null);
      if (!selected) return;
      void sendMove({ row: selected.row_idx, col: selected.col_idx }, { row, col });
      return;
    }
    if (piece?.is_mine) {
      setSelectedId(piece.piece_id);
      playSound('select');
    }
  }

  async function sendMove(from: Square, to: Square): Promise<void> {
    movingRef.current = true;
    try {
      const result = await submitMove(from, to);
      const sound = combatSound(result);
      if (sound) playSound(sound);
    } catch {
      /* useGameState records the rejection for the inline error. */
    } finally {
      movingRef.current = false;
    }
  }

  async function startRematch(): Promise<void> {
    try {
      const next = await rematch();
      navigate(`/setup?code=${encodeURIComponent(next.roomCode)}`);
    } catch {
      /* inline error */
    }
  }

  async function joinRematch(): Promise<void> {
    setJoining(true);
    try {
      const next = await acceptRematch();
      navigate(`/setup?code=${encodeURIComponent(next.roomCode)}`);
    } catch {
      setJoining(false);
    }
  }

  return (
    <div className="page-shell game">
      <main className="page-frame">
        <div className="game-layout">
          <div className="board-frame">
            {error ? (
              <p id="game-error" className="error" role="alert">
                {error}
              </p>
            ) : null}
            <Board
              pieces={pieces}
              moves={moves}
              mySlot={mySlot}
              isSpectator={isSpectator}
              selectedPieceId={selectedId}
              playerColor={playerColor}
              onCellClick={handleCell}
            />
          </div>
          <div className="graveyards-area">
            <GraveyardTray
              title={isSpectator ? 'Player 2 Losses' : 'Enemy Losses'}
              titleClass="enemy-label"
              pieces={pieceList}
              mode={
                isSpectator
                  ? { kind: 'slot', slot: 2 }
                  : { kind: 'enemy', ranks: inferEnemyDeadRanks(pieceList, moves) }
              }
              playerColor={playerColor}
            />
            <GraveyardTray
              title={isSpectator ? 'Player 1 Losses' : 'Your Losses'}
              titleClass="back-label"
              pieces={pieceList}
              mode={isSpectator ? { kind: 'slot', slot: 1 } : { kind: 'mine' }}
              playerColor={playerColor}
            />
          </div>
          <aside className="side-panel">
            <TurnIndicator
              gameRow={gameRow}
              mySlot={mySlot}
              isSpectator={isSpectator}
              notice={notice}
            />
            <GameActions
              finished={gameRow?.status === 'finished'}
              isSpectator={isSpectator}
              onResign={resign}
              onRematch={startRematch}
            />
            <h3>Move log</h3>
            <MoveLog
              moves={moves}
              pieces={pieces}
              mySlot={mySlot}
              isSpectator={isSpectator}
              isBotGame={Boolean(gameRow?.is_bot_game)}
            />
            <h3>Chat</h3>
            <ChatLog
              messages={chat}
              mySlot={mySlot}
              showForm={!isSpectator && gameRow != null && !gameRow.is_bot_game}
              onSend={sendChat}
            />
            {showAudio ? <AudioControls /> : null}
          </aside>
        </div>
        <RematchModal
          open={rematchCode !== null}
          joining={joining}
          onAccept={() => {
            void joinRematch();
          }}
          onDecline={() => {
            setJoining(false);
            dismissRematch();
          }}
        />
      </main>
    </div>
  );
}
