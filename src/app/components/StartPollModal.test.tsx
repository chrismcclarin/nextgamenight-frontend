// Axe audit for StartPollModal after its migration onto the shared <Modal>
// primitive with overlay-dismiss disabled (PRIM-02 / D-09). StartPollModal
// carries in-progress form state that resets on close, so it migrates with
// `dismissable={false}` (overlay click cannot discard input). This pins the
// migrated modal to the Radix a11y contract: role=dialog + zero axe violations
// rendered open with its form.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import StartPollModal from './StartPollModal';

// apiFetch is only called on submit; mock it so rendering never touches network.
vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({ prompt: { id: 'p1' } }),
}));

afterEach(cleanup);

const baseProps = {
  groupId: 'group-1',
  group: { games: [{ id: 'g1', name: 'Catan' }] },
  isOpen: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

describe('StartPollModal (migrated onto <Modal dismissable={false}>)', () => {
  it('renders as role=dialog when open', () => {
    render(<StartPollModal {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('preserves the "Start a check-in" header copy', () => {
    render(<StartPollModal {...baseProps} />);
    expect(screen.getByText('Start a check-in')).toBeInTheDocument();
  });

  it('passes an axe audit with no violations', async () => {
    render(<StartPollModal {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });
});
