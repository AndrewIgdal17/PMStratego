import type { JSX } from 'react';

export const PLAYER_COLORS = [
  { name: 'Forest Green', hex: '#4a7a4a' },
  { name: 'Navy Blue', hex: '#3a5a8a' },
  { name: 'Royal Purple', hex: '#6a4a8a' },
  { name: 'Teal', hex: '#3a7a7a' },
  { name: 'Gold', hex: '#8a7a3a' },
  { name: 'Crimson', hex: '#8a3a4a' },
  { name: 'Slate', hex: '#5a6a7a' },
  { name: 'Bronze', hex: '#8a6a3a' },
] as const;

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps): JSX.Element {
  return (
    <div className="color-picker">
      <span className="color-picker-label">Army color:</span>
      <div id="color-swatches" className="color-swatches">
        {PLAYER_COLORS.map((color) => {
          const selected = color.hex === value;
          return (
            <button
              key={color.hex}
              type="button"
              className={selected ? 'color-swatch selected' : 'color-swatch'}
              style={{ backgroundColor: color.hex }}
              title={color.name}
              aria-label={color.name}
              aria-pressed={selected}
              onClick={() => onChange(color.hex)}
            />
          );
        })}
      </div>
    </div>
  );
}
