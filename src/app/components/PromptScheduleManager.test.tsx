/**
 * R7 composed axe audit for `PromptScheduleManager` — one of the two audit surfaces
 * (`88.6-RESEARCH.md` §Q1, #5) that had NO test file at all, so this file is created rather
 * than extended. It runs AFTER this surface's last migration commit, per UI-SPEC §7.5.
 *
 * HOW THE AUDIT ROOT IS IDENTIFIED, and why it is not `getByRole('dialog')`.
 * The shipped analog (`QRCodeModal.test.tsx`, anchor `const dialog = screen.getByRole('dialog');`) scopes to that role,
 * because that component has exactly one rendered shape. This one has TWO, and BOTH are real:
 *
 *   - `variant="inline"` — the PRODUCTION shape. `PromptScheduleSection.js` mounts it this way
 *     for admins, and it renders a plain card `<div>`, not a dialog, so there is no `dialog`
 *     role to scope to. The root is taken as `container.firstElementChild`: the component's
 *     inline branch returns a SINGLE root element, so that node IS the component's own tree by
 *     construction — no test id is minted on production markup to find it.
 *   - `variant="modal"` — the component's DEFAULT and the shape the §Q1 modal census enumerated.
 *     It hosts on the shared `<Modal>`, which portals, so `container` never holds it and
 *     `getByRole('dialog')` is the correct scope for that one.
 *
 * Auditing both is not the doubled-per-breakpoint audit §7.5's 2026-09-09 amendment forbids —
 * these are two different DOM TREES, not one tree measured twice.
 *
 * VIEWPORT: this surface has NO media-query fork to audit. Neither it nor anything it renders
 * (`ScheduleForm`, `ScheduleList`, `Modal`, `KebabMenu`, `EmptyState`, `FetchErrorBanner`,
 * `Banner`, `Button`, `Heading`) calls `matchMedia` or a `useMediaQuery` hook — measured 0 hits
 * across all ten files. `ScheduleList`'s `hidden md:flex` desktop actions and its `md:hidden`
 * kebab are a CSS fork, and jsdom applies no CSS, so BOTH branches are present in the tree and
 * BOTH are audited by the single run below. No `matchMedia` stub is needed and no resize that
 * would measure nothing is performed.
 *
 * RULES: WCAG 4.1.2 and `heading-order`, run as two explicit `runOnly` passes. axe-core's
 * `runOnly` takes ONE selector, and `heading-order` is a best-practice rule that carries no
 * `wcag412` tag, so a single options object cannot express "this tag AND that rule" — folding
 * them would silently drop one. Two passes, each stating what it enables.
 *
 * THE FORM BRANCH IS NOT AUDITED FROM HERE, and that is a scope call rather than an omission.
 * `+ New Schedule` mounts `ScheduleForm`, which opens its OWN `<Modal>` and therefore its own
 * `role=dialog` tree — a different surface with its own suite (`ScheduleForm.test.tsx`). The
 * three `SelectControl`s the §Q1 prior's `select-name` findings would live in are inside it.
 * Auditing it from this file would score another surface's tree and put two owners on one
 * property.
 *
 * ZERO VIOLATIONS IS A RESULT HERE, NOT A BROKEN GATE — and the difference was demonstrated
 * rather than asserted. §7.5 records the prior as 3-for-3 finding real shipped `select-name`
 * failures, so a clean first audit deserves suspicion. Both rules were proven able to fail
 * against this exact scope, by planting each defect in the component and re-running test 1:
 * an unnamed `<button>` produced "Buttons must have discernible text (button-name)", and an
 * `<h5>` after the `<h3>` produced "Heading levels should only increase by one
 * (heading-order)". Neither mutant is committed.
 */
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

// The REAL `errCtx` is kept (importOriginal) and only the three logger members are spied, so
// the AC-2 assertion below measures the ctx the shared helper actually builds rather than a
// shape this test invented.
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    promptSettingsAPI: {
      ...actual.promptSettingsAPI,
      getGroupPromptSettings: vi.fn(),
      toggleSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    },
  };
});

import PromptScheduleManager from './PromptScheduleManager';
import { promptSettingsAPI } from '@/lib/api';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';

type Mock = ReturnType<typeof vi.fn>;

const anyProps = (p: Record<string, unknown>): any => p;

const SCHEDULE = {
  id: 's1',
  name: 'Thursday check-in',
  is_active: true,
  schedule_day_of_week: 4,
  schedule_time: '18:00',
};

const SETTINGS = { id: 'set1', schedules: [SCHEDULE], games: [], members: [] };

function renderManager(extra: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PromptScheduleManager
        {...anyProps({
          groupId: 'g1',
          group: { id: 'g1', games: [], members: [] },
          userRole: 'owner',
          variant: 'inline',
          ...extra,
        })}
      />
    </QueryClientProvider>
  );
}

// WCAG 4.1.2 is a TAG; `heading-order` is a RULE with no wcag412 tag. See the file docblock.
// NOT `as const` on the whole literal: axe-core's `RunOnly.values` is a MUTABLE `string[]`, so
// a fully-readonly literal fails `tsc --noEmit`. The narrowing is applied to `type` only.
const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('PromptScheduleManager — R7 composed axe audit (UI-SPEC §7.5)', () => {
  it('1. the INLINE surface passes WCAG 4.1.2 and heading-order', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    const { container } = renderManager();

    // Settle on a POPULATED-BRANCH element, not on the heading. The heading renders ABOVE
    // every branch, so awaiting it returns while the surface is still "Loading schedules..."
    // and the audit would score an almost-empty tree. Measured: the first draft of this file
    // did exactly that and was green on a tree with one paragraph in it.
    await screen.findByRole('button', { name: '+ New Schedule' });

    const root = container.firstElementChild as HTMLElement;
    expect(root, 'the inline branch returns a single root element').not.toBeNull();

    expect(await axe(root, WCAG_412)).toHaveNoViolations();
    expect(await axe(root, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. the MODAL surface passes the same two rules', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    renderManager({ variant: 'modal', onClose: vi.fn() });

    const dialog = await screen.findByRole('dialog');
    await screen.findByRole('button', { name: '+ New Schedule' });

    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('3. the EMPTY and ERROR branches are audited too, not just the populated one', async () => {
    // An audit of one branch is an audit of one branch. The empty branch swaps in EmptyState
    // plus its CTA and the error branch swaps in FetchErrorBanner's two link-buttons — both
    // are named-control surfaces, which is exactly what 4.1.2 is about.
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue({
      id: null,
      schedules: [],
      games: [],
      members: [],
    });
    const empty = renderManager();
    await screen.findByRole('heading', { name: 'No schedules yet' });
    expect(await axe(empty.container.firstElementChild as HTMLElement, WCAG_412)).toHaveNoViolations();
    expect(
      await axe(empty.container.firstElementChild as HTMLElement, HEADING_ORDER)
    ).toHaveNoViolations();
    cleanup();

    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockRejectedValue(
      new Error('boom')
    );
    const errored = renderManager();
    await screen.findByText("We couldn't load your schedules");
    expect(
      await axe(errored.container.firstElementChild as HTMLElement, WCAG_412)
    ).toHaveNoViolations();
    expect(
      await axe(errored.container.firstElementChild as HTMLElement, HEADING_ORDER)
    ).toHaveNoViolations();
  });
});

describe('PromptScheduleManager — the swept surface still renders (non-axe)', () => {
  // An audit-only file has no signal when the component is deleted or guts itself: axe on an
  // empty tree is clean. These are the render pins that make the audit above mean something.
  it('4. renders the migrated Heading at level 3 and the primary CTA', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    renderManager();

    expect(
      await screen.findByRole('button', { name: '+ New Schedule' })
    ).toBeInTheDocument();
    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'Recurring Check-ins',
    });
    expect(heading.tagName).toBe('H3');
  });
});

describe('PromptScheduleManager — AC-8 toast duration polarity + AC-2 channel', () => {
  async function loadedWithOneSchedule() {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    renderManager();
    // Same settle rule as the audits: wait for a row action, which only exists once the
    // settings query has resolved.
    await screen.findByRole('button', { name: 'Pause' });
  }

  it('5. a failed TOGGLE toasts with the ratified copy and NO options object', async () => {
    await loadedWithOneSchedule();
    (promptSettingsAPI.toggleSchedule as unknown as Mock).mockRejectedValue(new Error('boom'));

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const call = (toast.error as unknown as Mock).mock.calls[0];
    expect(call[0]).toBe("We couldn't update the schedule. Please try again.");
    // THE POLARITY. The toggle is non-destructive and keeps the ~4s house default, so there
    // must be no second argument at all — a `{ duration: Infinity }` leaking here would make
    // the recipe the ~20 expansion sweeps copy the wrong one.
    expect(call).toHaveLength(1);
  });

  it('6. a failed DELETE toasts with the ratified copy and a STICKY duration', async () => {
    await loadedWithOneSchedule();
    (promptSettingsAPI.deleteSchedule as unknown as Mock).mockRejectedValue(new Error('boom'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Delete' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const call = (toast.error as unknown as Mock).mock.calls[0];
    expect(call[0]).toBe("We couldn't delete the schedule. Please try again.");
    // AC-8: the throw skips invalidateSettings(), so the row stays on screen and a missed
    // ~4s notice reads as success.
    expect(call[1]).toEqual({ duration: Infinity });
  });

  it('7. both failures reach logger.info with the error NAME and MESSAGE, never the raw Error', async () => {
    // AC-2 as AMENDED 2026-09-13: `info`, not `error` — a Sentry BREADCRUMB, so the conversion
    // retires the raw `console.*` without creating an event or a Session Replay flush.
    await loadedWithOneSchedule();
    const boom = new TypeError('upstream exploded');
    (promptSettingsAPI.toggleSchedule as unknown as Mock).mockRejectedValue(boom);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(logger.info).toHaveBeenCalledTimes(1));
    expect(logger.info).toHaveBeenCalledWith('Error toggling schedule:', {
      name: 'TypeError',
      message: 'upstream exploded',
    });
    // T-84-01: a plain ctx object, never the Error itself (logger.info's second parameter is
    // `ctx?: Record<string, unknown>` and `checkJs: false` means tsc cannot see that mistake
    // at a `.js` call site).
    const ctx = (logger.info as unknown as Mock).mock.calls[0][1];
    expect(ctx).not.toBeInstanceOf(Error);
    expect(Object.keys(ctx as object).sort()).toEqual(['message', 'name']);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// A promise the test settles by hand, so each request and each refetch commits when the test says.
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PromptScheduleManager — Recurring Check-ins focus never falls to <body> (88.6.1-30, D-04/D-05)', () => {
  // The section heading is a level-3 Heading named EXACTLY this (the row headings are level 3 too,
  // but they carry the schedule name, so the exact string picks the section heading).
  const sectionHeading = () =>
    screen.getByRole('heading', { level: 3, name: 'Recurring Check-ins' });

  // clearAllMocks keeps queued Once values; a case that fails early would hand its unused queue to
  // the next case. Reset the three API stubs so every case starts from its own sequence.
  beforeEach(() => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockReset();
    (promptSettingsAPI.deleteSchedule as unknown as Mock).mockReset();
    (promptSettingsAPI.toggleSchedule as unknown as Mock).mockReset();
  });

  it('T1. Confirm Delete lands focus on the Recurring Check-ins heading, never <body> (H5)', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    const del = deferred();
    (promptSettingsAPI.deleteSchedule as unknown as Mock).mockReturnValue(del.promise);
    renderManager();

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    const heading = sectionHeading();
    // D-05: the markup carries no tab index of its own; the hook adds one when it focuses.
    expect(heading).not.toHaveAttribute('tabindex');

    deleteButton.focus();
    fireEvent.click(deleteButton);
    const confirm = screen.getByRole('button', { name: 'Confirm Delete' });
    confirm.focus();
    fireEvent.click(confirm);

    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute('tabindex')).toBe('-1');

    await act(async () => {
      del.resolve({});
    });
  });

  it('T2. focus moves only when a removal commits, and only once (R5 ordering backstop)', async () => {
    const refetch = deferred<typeof SETTINGS>();
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock)
      .mockResolvedValueOnce(SETTINGS)
      .mockReturnValueOnce(refetch.promise);
    const del = deferred();
    (promptSettingsAPI.deleteSchedule as unknown as Mock).mockReturnValue(del.promise);
    renderManager();

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    const heading = sectionHeading();

    deleteButton.focus();
    fireEvent.click(deleteButton);
    // Opening the confirm moves nothing (the held-out control: green before and after the fix).
    expect(document.activeElement).toBe(deleteButton);

    const confirm = screen.getByRole('button', { name: 'Confirm Delete' });
    confirm.focus();
    fireEvent.click(confirm);
    await waitFor(() => expect(document.activeElement).toBe(heading));

    // The delete settles, the refresh starts and is held, then commits an empty list.
    await act(async () => {
      del.resolve({});
    });
    await waitFor(() =>
      expect(promptSettingsAPI.getGroupPromptSettings).toHaveBeenCalledTimes(2)
    );
    await act(async () => {
      refetch.resolve({ ...SETTINGS, schedules: [] });
    });

    // Positive signal first: the schedule row (and its confirm row's ancestor) is gone.
    await screen.findByRole('heading', { name: 'No schedules yet' });
    // It acted once: the later removal of the schedule row moved nothing.
    expect(document.activeElement).toBe(heading);
  });

  it('T3. Cancel returns focus to the desktop Delete that opened the confirm', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    renderManager();

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    deleteButton.focus();
    fireEvent.click(deleteButton);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.click(cancel);

    await waitFor(() => expect(document.activeElement).toBe(deleteButton));
  });

  it('T4. Cancel on the phone path returns focus to the Schedule actions trigger', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    renderManager();

    const trigger = await screen.findByRole('button', { name: 'Schedule actions' });
    fireEvent.click(trigger);
    const listId = trigger.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    const list = document.getElementById(listId as string) as HTMLElement;
    fireEvent.click(within(list).getByRole('button', { name: 'Delete' }));
    // KebabMenu restored focus to its trigger after the item ran.
    expect(document.activeElement).toBe(trigger);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.click(cancel);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('T5. in the modal shape Confirm Delete lands on the dialog title, never the container or <body>', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    const del = deferred();
    (promptSettingsAPI.deleteSchedule as unknown as Mock).mockReturnValue(del.promise);
    renderManager({ variant: 'modal', onClose: vi.fn() });

    const dialog = await screen.findByRole('dialog');
    const deleteButton = await within(dialog).findByRole('button', { name: 'Delete' });
    deleteButton.focus();
    fireEvent.click(deleteButton);
    const confirm = within(dialog).getByRole('button', { name: 'Confirm Delete' });
    confirm.focus();
    fireEvent.click(confirm);

    const title = within(screen.getByRole('dialog')).getByRole('heading', {
      name: 'Recurring Check-ins',
    });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(document.activeElement).not.toBe(screen.getByRole('dialog'));
    expect(document.activeElement).not.toBe(document.body);

    await act(async () => {
      del.resolve({});
    });
  });

  it('T6. a Confirm Delete pressed while focus is on <body> (the Safari pointer shape) still lands on the heading', async () => {
    (promptSettingsAPI.getGroupPromptSettings as unknown as Mock).mockResolvedValue(SETTINGS);
    const del = deferred();
    (promptSettingsAPI.deleteSchedule as unknown as Mock).mockReturnValue(del.promise);
    renderManager();

    const deleteButton = await screen.findByRole('button', { name: 'Delete' });
    const heading = sectionHeading();
    // No focus() calls: the pointer shape where the clicked button never took focus.
    fireEvent.click(deleteButton);
    const confirm = screen.getByRole('button', { name: 'Confirm Delete' });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(confirm);

    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.activeElement).not.toBe(document.body);

    await act(async () => {
      del.resolve({});
    });
  });
});
