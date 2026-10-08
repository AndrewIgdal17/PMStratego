import type { JSX } from 'react';
import type { ViewSlot } from '../lib/gameHelpers.ts';
import type { GameRow } from '../types.ts';

interface TurnIndicatorProps {
  gameRow: GameRow | null;
  mySlot: ViewSlot;
  isSpectator: boolean;
  notice: string | null;
}

export function TurnIndicator({
  gameRow,
  mySlot,
  isSpectator,
  notice,
}: TurnIndicatorProps): JSX.Element {
  if (notice) {
    return (
      <p id="turn-indicator" className="turn-indicator">
        {notice}
      </p>
    );
  }
  if (!gameRow) {
    return <p id="turn-indicator" className="turn-indicator" />;
  }
  if (gameRow.status === 'finished') {
    if (isSpectator) {
      return (
        <p id="turn-indicator" className="turn-indicator">
          {`Game Over — Player ${gameRow.winner_slot ?? '?'} wins!`}
        </p>
      );
    }
    const won = gameRow.winner_slot === mySlot;
    return (
      <p id="turn-indicator" className={`turn-indicator ${won ? 'result-win' : 'result-loss'}`}>
        {won ? 'Victory! You won!' : 'Defeat. You lost.'}
      </p>
    );
  }
  if (isSpectator) {
    const bot = gameRow.is_bot_game && gameRow.current_turn_slot === 2;
    return (
      <p id="turn-indicator" className="turn-indicator">
        {bot ? "Bot's turn..." : `Player ${gameRow.current_turn_slot ?? '?'}'s turn`}
      </p>
    );
  }
  const text =
    gameRow.current_turn_slot === mySlot
      ? 'Your turn'
      : gameRow.is_bot_game
        ? "Bot's turn..."
        : 'Waiting for opponent...';
  return (
    <p id="turn-indicator" className="turn-indicator">
      {text}
    </p>
  );
}
