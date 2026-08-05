// Phase 88-25 (Req 14 / F-761): the pre-storage-read flash + the info treatment.
//
// The defect this pins: the banner used to start VISIBLE and be hidden by an
// effect, so someone who had already dismissed it saw it flash on every load.
// The fix starts HIDDEN and reveals — so the wrong state is never painted.
//
// Both halves are asserted, because either one alone is vacuous:
//   - "never appears when dismissed" alone passes for a banner that never
//     renders at all;
//   - "appears when not dismissed" alone passes for the old flashing shape.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import AutoPromptBehaviorBanner from './AutoPromptBehaviorBanner';

const STORAGE_KEY = 'auto-prompt-behavior-banner-dismissed-v1';

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('AutoPromptBehaviorBanner storage-read flash (Phase 88-25 / F-761)', () => {
  it('pre-seeded as dismissed: the banner is NEVER painted, not even for one render', () => {
    localStorage.setItem(STORAGE_KEY, '1');

    // `render` from RTL wraps in act(), so the mount effect has already run by
    // the time we assert — which is exactly the frame the old shape leaked in.
    const { container } = render(<AutoPromptBehaviorBanner />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/recurring poll behavior changed/i)).not.toBeInTheDocument();
  });

  it('not dismissed: the banner appears once the storage check has run', () => {
    render(<AutoPromptBehaviorBanner />);

    expect(screen.getByText(/recurring poll behavior changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss banner/i })).toBeInTheDocument();
  });

  it('the FIRST render paints nothing — server HTML is empty, so the reveal is effect-driven', () => {
    // This is the assertion that actually distinguishes "starts hidden, reveals"
    // from "starts visible, then hides". Effects do not run during SSR, so
    // renderToString sees exactly the first render — which is also the render
    // the client must hydrate against.
    //
    // It pins BOTH properties at once:
    //   - no flash: the pre-storage-read state paints nothing;
    //   - no hydration mismatch: server and client first render agree, which is
    //     why the storage read cannot move into a useState initialiser.
    expect(renderToString(<AutoPromptBehaviorBanner />)).toBe('');
  });

  it('dismissing persists and hides immediately', async () => {
    const { getByRole } = render(<AutoPromptBehaviorBanner />);

    await act(async () => {
      getByRole('button', { name: /dismiss banner/i }).click();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
    expect(screen.queryByText(/recurring poll behavior changed/i)).not.toBeInTheDocument();
  });
});

describe('AutoPromptBehaviorBanner info treatment (D-33)', () => {
  it('renders on the Banner primitive with its info tone, not a bare uncoloured border', () => {
    const { container } = render(<AutoPromptBehaviorBanner />);
    const banner = container.firstElementChild as HTMLElement;

    // Banner's info variant: `border-line` supplies the colour. The regression
    // being pinned is a `border` with NO colour utility beside it.
    expect(banner.className).toContain('border-line');
    expect(banner.className).toContain('rounded-card');
  });

  it('the dismiss control uses a token that exists — never `text-status-info`', () => {
    // `--color-status-info` is deliberately not a token (D-33: four status
    // families, no fifth). A `text-status-info` class therefore emits no rule
    // at all, which is how this button shipped uncoloured.
    render(<AutoPromptBehaviorBanner />);
    const btn = screen.getByRole('button', { name: /dismiss banner/i });
    expect(btn.className).not.toContain('status-info');
    expect(btn.className).toContain('text-content-link');
  });

  it('the dismiss control clears the 44px phone touch floor', () => {
    render(<AutoPromptBehaviorBanner />);
    const btn = screen.getByRole('button', { name: /dismiss banner/i });
    expect(btn.className).toContain('min-h-11');
  });
});
