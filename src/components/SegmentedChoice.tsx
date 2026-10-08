import type { JSX } from 'react';

interface SegmentedChoiceProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function SegmentedChoice<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: SegmentedChoiceProps<T>): JSX.Element {
  return (
    <div className="setup-controls">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`difficulty-btn ${opt.value === value ? 'selected' : ''}`}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
