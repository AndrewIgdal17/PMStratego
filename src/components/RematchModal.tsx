import type { JSX } from 'react';

interface RematchModalProps {
  open: boolean;
  joining: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function RematchModal({ open, joining, onAccept, onDecline }: RematchModalProps): JSX.Element | null {
  if (!open) return null;
  return (
    <div
      id="rematch-modal"
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rematch-title"
    >
      <div className="modal-box">
        <h2 id="rematch-title">Rematch!</h2>
        <p>Your opponent wants a rematch.</p>
        <div className="modal-actions">
          <button
            type="button"
            id="accept-rematch-btn"
            className="btn-primary"
            disabled={joining}
            onClick={onAccept}
          >
            {joining ? 'Joining...' : 'Accept'}
          </button>
          <button type="button" id="decline-rematch-btn" className="btn-danger" onClick={onDecline}>
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
