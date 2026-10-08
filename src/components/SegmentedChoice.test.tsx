/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedChoice } from './SegmentedChoice.tsx';

afterEach(() => {
  cleanup();
});

const options = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
] as const;

describe('SegmentedChoice', () => {
  it('marks the selected option and reports clicks', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedChoice options={[...options]} value="medium" onChange={onChange} />,
    );

    expect(container.querySelector('.setup-controls')).not.toBeNull();
    const easy = screen.getByRole('button', { name: 'Easy' });
    const medium = screen.getByRole('button', { name: 'Medium' });
    const hard = screen.getByRole('button', { name: 'Hard' });

    expect(easy.classList.contains('difficulty-btn')).toBe(true);
    expect(easy.classList.contains('selected')).toBe(false);
    expect(medium.classList.contains('difficulty-btn')).toBe(true);
    expect(medium.classList.contains('selected')).toBe(true);
    expect(hard.classList.contains('selected')).toBe(false);

    fireEvent.click(hard);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hard');
  });

  it('does not report clicks while disabled', () => {
    const onChange = vi.fn();
    render(
      <SegmentedChoice options={[...options]} value="easy" onChange={onChange} disabled />,
    );

    const easy = screen.getByRole('button', { name: 'Easy' });
    expect(easy.hasAttribute('disabled')).toBe(true);
    fireEvent.click(easy);
    expect(onChange).not.toHaveBeenCalled();
  });
});
