/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PieceToken } from './PieceToken.tsx';

afterEach(() => {
  cleanup();
});

function svgOf(ui: ReactElement): SVGSVGElement {
  const { container } = render(ui);
  const svg = container.querySelector('svg');
  if (!(svg instanceof SVGSVGElement)) throw new Error('expected an svg');
  return svg;
}

describe('PieceToken', () => {
  it('draws an own Marshal coin with the default green and a curved name', () => {
    const svg = svgOf(<PieceToken rank="1" isMine />);

    expect(svg.getAttribute('viewBox')).toBe('0 0 72 72');
    expect(svg.classList.contains('piece-token')).toBe(true);

    const [disc, ring] = svg.querySelectorAll('circle');
    expect(disc?.getAttribute('cx')).toBe('36');
    expect(disc?.getAttribute('cy')).toBe('36');
    expect(disc?.getAttribute('r')).toBe('33');
    expect(disc?.getAttribute('fill')).toBe('#4a7a4a');
    expect(disc?.getAttribute('stroke')).toBe('#2a5a2a');
    expect(disc?.getAttribute('stroke-width')).toBe('2.5');
    expect(ring?.getAttribute('r')).toBe('27');
    expect(ring?.getAttribute('fill')).toBe('none');
    expect(ring?.getAttribute('stroke')).toBe('rgba(255,255,255,0.1)');
    expect(ring?.getAttribute('stroke-width')).toBe('1');

    const arc = svg.querySelector('path');
    const textPath = svg.querySelector('textPath');
    expect(arc?.getAttribute('d')).toBe('M 10,36 a 26,26 0 0,1 52,0');
    expect(arc?.id).toBeTruthy();
    expect(arc?.id.includes(':')).toBe(false);
    expect(textPath?.getAttribute('href')).toBe(`#${arc?.id}`);
    expect(textPath?.getAttribute('startOffset')).toBe('50%');
    expect(textPath?.getAttribute('text-anchor')).toBe('middle');
    expect(textPath?.textContent).toBe('Marshal');

    const nameText = textPath?.parentElement;
    expect(nameText?.getAttribute('font-size')).toBe('7');
    expect(nameText?.getAttribute('fill')).toBe('#e0f0e0');
    expect(nameText?.getAttribute('opacity')).toBe('0.85');
    expect(nameText?.getAttribute('font-family')).toContain('TokenScript');
    expect(nameText?.getAttribute('letter-spacing')).toBe('1');

    const center = svg.querySelectorAll('text')[1];
    expect(center?.textContent).toBe('10');
    expect(center?.getAttribute('font-size')).toBe('18');
    expect(center?.getAttribute('font-weight')).toBe('bold');
    expect(center?.getAttribute('fill')).toBe('#e0f0e0');
    expect(center?.getAttribute('text-anchor')).toBe('middle');
    expect(center?.getAttribute('x')).toBe('36');
    expect(center?.getAttribute('y')).toBe('46');
    expect(center?.getAttribute('font-style')).toBeNull();
  });

  it('uses the supplied color for own pieces and darkens the stroke', () => {
    const svg = svgOf(<PieceToken rank={5} isMine color="#ffffff" />);
    const disc = svg.querySelector('circle');
    expect(disc?.getAttribute('fill')).toBe('#ffffff');
    expect(disc?.getAttribute('stroke')).toBe('#dfdfdf');
    expect(svg.querySelector('textPath')?.textContent).toBe('Captain');
    expect(svg.querySelectorAll('text')[1]?.textContent).toBe('6');
    expect(svg.querySelectorAll('text')[1]?.getAttribute('font-size')).toBe('22');
  });

  it('paints enemy pieces red, including a numeric spy', () => {
    const svg = svgOf(<PieceToken rank={10} isMine={false} color="#ffffff" />);
    const disc = svg.querySelector('circle');
    expect(disc?.getAttribute('fill')).toBe('#8b4444');
    expect(disc?.getAttribute('stroke')).toBe('#6a2a2a');
    expect(svg.querySelector('textPath')?.textContent).toBe('Spy');
    expect(svg.querySelector('text')?.getAttribute('fill')).toBe('#f0d0d0');

    const center = svg.querySelectorAll('text')[1];
    expect(center?.textContent).toBe('S');
    expect(center?.getAttribute('font-size')).toBe('24');
    expect(center?.getAttribute('font-style')).toBe('italic');
    expect(center?.getAttribute('y')).toBe('46');
    expect(center?.getAttribute('fill')).toBe('#f0d0d0');
  });

  it('renders bomb and flag as emoji with a higher center', () => {
    const bomb = svgOf(<PieceToken rank="BOMB" isMine />);
    const bombCenter = bomb.querySelectorAll('text')[1];
    expect(bomb.querySelector('textPath')?.textContent).toBe('Bomb');
    expect(bombCenter?.textContent).toBe('💣');
    expect(bombCenter?.getAttribute('font-size')).toBe('20');
    expect(bombCenter?.getAttribute('y')).toBe('44');

    const flag = svgOf(<PieceToken rank="FLAG" isMine={false} />);
    const flagCenter = flag.querySelectorAll('text')[1];
    expect(flag.querySelector('textPath')?.textContent).toBe('Flag');
    expect(flagCenter?.textContent).toBe('🚩');
    expect(flagCenter?.getAttribute('font-size')).toBe('20');
    expect(flagCenter?.getAttribute('y')).toBe('44');
  });

  it('shows a question mark and no arc when the rank is unknown or hidden', () => {
    for (const rank of [null, 'NOPE'] as const) {
      const svg = svgOf(<PieceToken rank={rank} isMine />);
      expect(svg.querySelector('path')).toBeNull();
      expect(svg.querySelector('textPath')).toBeNull();
      expect(svg.querySelector('text')?.textContent).toBe('?');
    }
  });

  it('gives each token its own stable arc id', () => {
    const { container, rerender } = render(<PieceToken rank="1" isMine />);
    const first = container.querySelector('path')?.id;
    expect(first).toBeTruthy();

    rerender(<PieceToken rank="9" isMine />);
    expect(container.querySelector('path')?.id).toBe(first);
    expect(container.querySelector('textPath')?.textContent).toBe('Scout');
    expect(container.querySelectorAll('text')[1]?.textContent).toBe('2');

    cleanup();
    const pair = render(
      <>
        <PieceToken rank="1" isMine />
        <PieceToken rank="2" isMine />
      </>,
    );
    const ids = [...pair.container.querySelectorAll('path')].map((path) => path.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});
