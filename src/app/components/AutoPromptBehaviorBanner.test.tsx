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
import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
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
      getByRole('button', { name: 'Got it' }).click();
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
    const btn = screen.getByRole('button', { name: 'Got it' });
    expect(btn.className).not.toContain('status-info');
    expect(btn.className).toContain('text-content-link');
  });

  it('the dismiss control clears the 44px phone touch floor', () => {
    render(<AutoPromptBehaviorBanner />);
    const btn = screen.getByRole('button', { name: 'Got it' });
    expect(btn.className).toContain('min-h-11');
  });
});

// Phase 88.6.1-79 (Req 5, D-04 / D-05 / D-07): `Got it` removes the banner together with the
// focused button. Focus must land on the host's target (on its one mount, the Check-ins expand
// control), else plan 04's floor — never `<body>`. The button's accessible name is its visible
// text (WCAG 2.5.3, review #241). Testing Library string names are exact by default.
describe('Got it keeps focus (88.6.1-79, Req 5)', () => {
  function Host() {
    const ref = React.useRef<HTMLButtonElement | null>(null);
    return (
      <div>
        <button type="button" ref={ref}>
          Check-ins
        </button>
        <AutoPromptBehaviorBanner focusFallbackRef={ref} />
      </div>
    );
  }

  it('AB1: with the host target, focus lands on the Check-ins control after Got it', async () => {
    render(<Host />);
    const gotIt = await screen.findByRole('button', { name: 'Got it' });
    act(() => gotIt.focus());
    await act(async () => {
      gotIt.click();
    });

    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Check-ins' }))
    );
  });

  it('AB3: an UNFOCUSED tap (iOS Safari: focus stays on body) still lands focus on the Check-ins control (88.6.1 code review A-12)', async () => {
    render(<Host />);
    const gotIt = await screen.findByRole('button', { name: 'Got it' });
    expect(document.activeElement).toBe(document.body);
    // element.click() does not focus the button, as a WebKit tap does not.
    await act(async () => {
      gotIt.click();
    });

    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Check-ins' }))
    );
  });

  it('AB2: with no host target, focus lands on the page floor (main h1), never body', async () => {
    render(
      <main>
        <h1>Plan the next game</h1>
        <AutoPromptBehaviorBanner />
      </main>
    );
    const gotIt = await screen.findByRole('button', { name: 'Got it' });
    act(() => gotIt.focus());
    await act(async () => {
      gotIt.click();
    });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('AB3: the button is named by its own visible text (WCAG 2.5.3 Label in Name)', () => {
    render(<AutoPromptBehaviorBanner />);
    const byText = screen.getByText('Got it').closest('button');
    expect(byText).not.toBeNull();
    const text = (byText?.textContent ?? '').trim().toLowerCase();
    // The computed name, lower-cased, starts with the visible text, lower-cased.
    const named = screen.getByRole('button', {
      name: (accessibleName) => accessibleName.toLowerCase().startsWith(text),
    });
    expect(named).toBe(byText);
  });
});
