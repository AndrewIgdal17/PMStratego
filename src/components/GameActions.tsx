import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';

interface GameActionsProps {
  finished: boolean;
  isSpectator: boolean;
  onResign: () => Promise<void>;
  onRematch: () => Promise<void>;
}

export function GameActions({
  finished,
  isSpectator,
  onResign,
  onRematch,
}: GameActionsProps): JSX.Element {
  const { auth, isLoggedIn } = useAuth();
  const [asking, setAsking] = useState(false);
  const showResign = !isSpectator && !finished;
  const showRematch = !isSpectator && finished;
  const showProfile = showRematch && isLoggedIn && !!auth.username;

  async function confirmResign(): Promise<void> {
    setAsking(false);
    try {
      await onResign();
    } catch {
      /* The hook stores the message for the inline error near the board. */
    }
  }

  return (
    <>
      <div className="game-actions">
        <button
          type="button"
          id="resign-btn"
          className="btn-danger"
          hidden={!showResign}
          onClick={() => setAsking(true)}
        >
          Resign
        </button>
        <button
          type="button"
          id="rematch-btn"
          className="btn-primary"
          hidden={!showRematch}
          onClick={() => {
            void onRematch();
          }}
        >
          Rematch
        </button>
        <Link id="home-btn" to="/" className="btn-secondary" hidden={!finished}>
          Home
        </Link>
        {auth.username ? (
          <Link
            id="profile-btn"
            to={`/profile?user=${encodeURIComponent(auth.username)}`}
            className="btn-secondary"
            hidden={!showProfile}
          >
            My Profile
          </Link>
        ) : null}
      </div>
      {asking ? (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="resign-title">
          <div className="modal-box">
            <h2 id="resign-title">Resign this game?</h2>
            <div className="modal-actions">
              <button type="button" className="btn-danger" onClick={() => void confirmResign()}>
                Resign
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
