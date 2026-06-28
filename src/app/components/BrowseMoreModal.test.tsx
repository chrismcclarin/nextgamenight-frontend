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
vi.mock('../../lib/api', () => ({
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
});
