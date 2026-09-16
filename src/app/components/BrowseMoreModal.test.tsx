// Axe audit for BrowseMoreModal after its migration onto the shared <Modal>
// primitive at size="lg" (PRIM-02). BrowseMoreModal is the wide (max-w-4xl)
// modal with a sticky filter/sort toolbar pinned over a scrollable suggestion
// grid. This pins the migrated modal to the Radix a11y contract: role=dialog +
// zero axe violations rendered open.
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import BrowseMoreModal from './BrowseMoreModal';

// suggestionsAPI fires on open; mock it to an empty result so the modal settles
// into its (library-empty) state without touching network.
//
// Plan 88.6-32: `importOriginal` + spread, NOT the full-replacement factory this used to be.
// The component's error branch now calls `getFetchErrorMessage`, which derives its code via
// `error instanceof ApiError` (`useFetchErrorState.ts:116`) — and a full replacement DELETES
// `ApiError` from the module, so that check would throw or silently never match. The same
// idiom, and the same reason, as `friends/page.backendDown.test.tsx`.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  suggestionsAPI: {
    getGroupSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
    getEventSuggestions: vi.fn().mockResolvedValue({ suggestions: [] }),
  },
}));

afterEach(cleanup);

const baseProps = {
  open: true,
  onClose: vi.fn(),
  groupId: 'group-1',
  defaultPlayerCount: 4,
  onSelectGame: vi.fn(),
};

describe('BrowseMoreModal (migrated onto <Modal size="lg">)', () => {
  it('renders as role=dialog when open', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('passes an axe audit with no violations', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    const dialog = await screen.findByRole('dialog');
    // Let the open-fetch resolve so the empty state (not the loading text) is
    // what axe audits.
    await waitFor(() =>
      expect(
        screen.getByText(/add games to your collection/i)
      ).toBeInTheDocument()
    );
    expect(await axe(dialog)).toHaveNoViolations();
  });

  // Plan 88.6-32 (R2). The library-empty CTA migrated from
  // `<Link className="btn btn-primary …">` to `<Button asChild variant="primary"><Link …>`.
  // WITHOUT `asChild` (`Button.tsx:113`) `Button` renders a real `<button>` and this CTA
  // silently stops navigating — and the two assertions that already existed here matched its
  // TEXT only, so both would have stayed green on exactly that regression. Role + href is the
  // pair that catches it: `role=link` dies if the element becomes a `<button>`, and `href`
  // dies if `asChild` is present but the `<Link>`'s props are dropped.
  it('keeps the library-empty CTA a real link to /userProfile (asChild, not a dead button)', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    await screen.findByRole('dialog');
    const cta = await screen.findByRole('link', {
      name: /add games to your collection/i,
    });
    expect(cta).toHaveAttribute('href', '/userProfile');
    // The `.btn` class is gone and the primitive's own base is on the element — the migration
    // must not leave both expressions of the same styling behind.
    expect(cta).toHaveClass('btn');
    expect(cta.className).not.toMatch(/\binline-block\b/);
    // Nothing named this way is a <button>: queryByRole('button', …) must find nothing.
    expect(
      screen.queryByRole('button', { name: /add games to your collection/i })
    ).toBeNull();
  });

  // Plan 88.6-32 (D-10 / AC-10). The two 32x32 player-count steppers are the phase's ONLY
  // permanent `.btn` exemption: they stay raw `.btn btn-compact` rather than becoming
  // `<Button>`, and under plan 05's ARM A they carry the house focus ring in its INSET form
  // (never `ring-offset-2` — an offset ring on a 32px square in a tight toolbar paints into
  // its twin). Pinned so a later "consistency" sweep cannot migrate them or swap the ring form
  // without reading the markers at the site.
  it('leaves both player-count steppers on `.btn-compact` with an INSET focus ring', async () => {
    render(<BrowseMoreModal {...baseProps} />);
    await screen.findByRole('dialog');
    for (const name of [/decrease player count/i, /increase player count/i]) {
      const stepper = screen.getByRole('button', { name });
      expect(stepper).toHaveClass('btn-compact');
      expect(stepper).toHaveClass('focus-visible:ring-inset');
      expect(stepper.className).not.toMatch(/focus-visible:ring-offset-/);
      // The exemption is about SIZE — 32x32, above WCAG 2.5.8's 24px floor.
      expect(stepper).toHaveClass('w-8');
      expect(stepper).toHaveClass('h-8');
    }
  });
});
