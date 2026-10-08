/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardCell, boardCellLabel } from './BoardCell.tsx';

afterEach(() => {
  cleanup();
});

describe('boardCellLabel', () => {
  it('names own pieces, fogged enemies, empty squares, and lakes', () => {
    expect(boardCellLabel('A7', { kind: 'piece', side: 'you', rankName: 'Marshal' })).toBe(
      'Your Marshal at A7',
    );
    expect(boardCellLabel('C4', { kind: 'piece', side: 'enemy', rankName: null })).toBe(
      'Enemy piece at C4',
    );
    expect(boardCellLabel('C4', { kind: 'piece', side: 'enemy', rankName: 'Scout' })).toBe(
      'Enemy Scout at C4',
    );
    expect(boardCellLabel('E5', { kind: 'empty' })).toBe('Empty square E5');
    expect(boardCellLabel('B4', { kind: 'lake' })).toBe('Lake');
  });
});

describe('BoardCell', () => {
  it('exposes the accessible name and activates from click, Enter, and Space', () => {
    const onActivate = vi.fn();
    render(
      <BoardCell
        label="Your Marshal at A7"
        onActivate={onActivate}
      >
        <span>token</span>
      </BoardCell>,
    );

    const cell = screen.getByRole('button', { name: 'Your Marshal at A7' });
    expect(cell.tabIndex).toBe(0);
    expect(cell.classList.contains('board-cell')).toBe(true);
    expect(cell.textContent).toContain('token');

    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.keyDown(cell, { key: ' ' });
    fireEvent.keyDown(cell, { key: 'Tab' });

    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it('marks lakes and the selected square', () => {
    const { rerender } = render(
      <BoardCell label="Lake" lake onActivate={() => {}} />,
    );
    const lake = screen.getByRole('button', { name: 'Lake' });
    expect(lake.classList.contains('lake')).toBe(true);
    expect(lake.textContent).toBe('~');

    rerender(
      <BoardCell label="Enemy piece at C4" selected onActivate={() => {}}>
        <span>enemy</span>
      </BoardCell>,
    );
    const enemy = screen.getByRole('button', { name: 'Enemy piece at C4' });
    expect(enemy.classList.contains('selected')).toBe(true);
    expect(enemy.getAttribute('aria-pressed')).toBe('true');
  });
});
