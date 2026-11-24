// D-04 accessibility contract for the shared Icon wrapper (PRIM-04).
//
// Icon centralizes ONE aria treatment over lucide-react: decorative by default
// (aria-hidden), and a labeled `title` → role="img" + accessible name. The
// inline-SVG escape hatch must route through the SAME contract.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Icon, ICON_TEXT_CAP_PX, iconTextSize } from './Icon';

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

// Phase 89.6-06 (owner pick O-M4 = Fixed+): an icon that follows the text size up to 32px.
// jsdom drops an inline min() width (it reads back as an empty string and the style attribute
// stays null; jsdom 29.1.1, checked 2026-11-23), so nothing here reads the svg's inline size: the
// rendered size is measured in Chromium, in e2e/primitives-large-text.spec.ts ("O-M4 enlarged text (89.6-06)").
// What jsdom can see is the marker a call site's unit pin reads: data-follow-text.
describe('89.6-06 O-M4: an icon size that follows text up to 32px', () => {
  it('iconTextSize is the one formula: the rem size capped at 32px', () => {
    expect(ICON_TEXT_CAP_PX).toBe(32);
    expect(iconTextSize(20)).toBe('min(1.25rem, 32px)');
    expect(iconTextSize(24)).toBe('min(1.5rem, 32px)');
  });

  it('without followText the svg keeps its numeric size and carries no marker', () => {
    const { container } = render(<Icon name="X" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).not.toHaveAttribute('style');
    expect(svg).not.toHaveAttribute('data-follow-text');
  });

  it('with followText the svg keeps its numeric size attribute and carries data-follow-text', () => {
    const { container } = render(<Icon name="X" size={20} followText />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('data-follow-text');
  });
});
