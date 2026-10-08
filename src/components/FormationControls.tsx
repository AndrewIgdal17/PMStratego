import type { JSX } from 'react';

interface FormationControlsProps {
  disabled: boolean;
  onRandom: () => void;
  onDefensive: () => void;
  onAggressive: () => void;
  onClear: () => void;
}

export function FormationControls({
  disabled,
  onRandom,
  onDefensive,
  onAggressive,
  onClear,
}: FormationControlsProps): JSX.Element {
  return (
    <div className="setup-controls">
      <button type="button" data-formation="random" disabled={disabled} onClick={onRandom}>
        Random
      </button>
      <button type="button" data-formation="defensive" disabled={disabled} onClick={onDefensive}>
        Defensive
      </button>
      <button type="button" data-formation="aggressive" disabled={disabled} onClick={onAggressive}>
        Aggressive
      </button>
      <button type="button" id="clear-btn" disabled={disabled} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
