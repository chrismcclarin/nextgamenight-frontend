// D-04 accessibility contract for the shared Icon wrapper (PRIM-04).
//
// Icon centralizes ONE aria treatment over lucide-react: decorative by default
// (aria-hidden), and a labeled `title` → role="img" + accessible name. The
// inline-SVG escape hatch must route through the SAME contract.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Icon } from './Icon';

afterEach(cleanup);

describe('Icon aria contract', () => {
  it('is aria-hidden (decorative) by default and renders the matching lucide glyph', () => {
    const { container } = render(<Icon name="X" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    // Decorative icons expose no accessible name.
    expect(svg).not.toHaveAttribute('role', 'img');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('with a title, exposes role="img" and the accessible name', () => {
    render(<Icon name="X" title="Close" />);
    const img = screen.getByRole('img', { name: 'Close' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img).toHaveAttribute('aria-label', 'Close');
    expect(img).not.toHaveAttribute('aria-hidden');
  });

  it('maps size/color onto the wrapped svg', () => {
    const { container } = render(<Icon name="X" size={32} color="currentColor" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('height', '32');
  });

  it('routes the inline-SVG escape hatch through the same aria contract', () => {
    render(
      <Icon
        title="Dice"
        render={(props) => (
          <svg {...props} data-testid="meeple" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" />
          </svg>
        )}
      />
    );
    const img = screen.getByRole('img', { name: 'Dice' });
    expect(img).toHaveAttribute('data-testid', 'meeple');
    expect(img).toHaveAttribute('aria-label', 'Dice');
  });
});
