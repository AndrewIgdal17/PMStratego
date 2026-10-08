import type { JSX } from 'react';
import { ARMY_SIZE } from '../rules/pieces.ts';

interface SubmitControlsProps {
  placed: number;
  submitted: boolean;
  submitting: boolean;
  countdownSeconds: number | null;
  starting: boolean;
  status: string | null;
  onSubmit: () => void;
  onUnsubmit: () => void;
}

export function SubmitControls({
  placed,
  submitted,
  submitting,
  countdownSeconds,
  starting,
  status,
  onSubmit,
  onUnsubmit,
}: SubmitControlsProps): JSX.Element {
  const ready = placed === ARMY_SIZE;
  const submitLabel = ready ? 'Submit setup' : `Submit setup (${placed}/${ARMY_SIZE})`;
  const showCountdown = starting || countdownSeconds !== null;

  return (
    <>
      <button
        type="button"
        id="submit-setup-btn"
        className="btn-primary"
        disabled={!ready || submitting || submitted}
        hidden={submitted}
        onClick={onSubmit}
      >
        {submitLabel}
      </button>
      <button
        type="button"
        id="unsubmit-btn"
        className="btn-danger"
        hidden={!submitted}
        onClick={onUnsubmit}
      >
        Unsubmit
      </button>
      <p id="countdown-display" hidden={!showCountdown}>
        {starting
          ? 'Starting game...'
          : countdownSeconds !== null
            ? `Game starting in ${countdownSeconds}...`
            : ''}
      </p>
      <p id="setup-status" className="result" hidden={!status}>
        {status}
      </p>
    </>
  );
}
