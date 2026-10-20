// The report form outlives the banner that opened it (plan 88.6.1-69, Task 3).
//
// The known bug this fixes: the report form used to live INSIDE the banner, so when the failure
// recovered while the form was open (the hook's tab-return re-attempt, or any caller that removes
// the banner when its data loads) the banner took the form, and the person's typed report, with
// it. The owner's ruling makes that more likely: the form now opens right after a failed retry,
// while recovery attempts run. The form now renders from FeedbackModalProvider, the app-level
// host that never unmounts, and the banner's Report this asks it to open with the same prefill.
//
// Mocks follow FeedbackModals.test.tsx (next/navigation, useSelfIdentity, @/lib/api with the
// real module spread). userEvent.setup(); positive waitFor signals only (CF-26); line comments
// only (CF-9).
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseQueryResult } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/userProfile',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// The form reads the contact handle off the shared self row; this suite is about where the form
// lives, not identity, so the hook is stubbed (FeedbackModals.test.tsx does the same).
vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    self: { id: 'u-1', email: 'self@example.test' },
    selfUuid: 'u-1',
    query: { isError: false, error: null, isPending: false, isFetching: false, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    feedbackAPI: {
      ...actual.feedbackAPI,
      submitFeedback: vi.fn().mockResolvedValue({ success: true }),
      submitGitHubFeedback: vi.fn().mockResolvedValue({ success: true }),
    },
  };
});

import { ApiError } from '@/lib/api';
import { Modal } from '@/app/components/Modal';
import { FeedbackModalProvider, useFeedbackModal } from '@/app/components/FeedbackModalProvider';
import * as FeedbackHost from '@/app/components/FeedbackModalProvider';
import { FetchErrorBanner } from './FetchErrorBanner';
import { useFetchErrorState } from './useFetchErrorState';
import type { FetchErrorState } from './useFetchErrorState';

afterEach(() => cleanup());

const DIALOG_NAME = 'Report Bug or Suggest Feature';
const LIST_TITLE = "Couldn't load the list";
const TYPED = ' It broke after the update.';

function failedState(over: Partial<FetchErrorState> = {}): FetchErrorState {
  return {
    showError: true,
    message: 'We could not reach the list.',
    code: 'network',
    retry: vi.fn().mockResolvedValue(undefined),
    retryFailed: true,
    ...over,
  };
}

// The unchanged composition (FetchErrorBanner's `const subject =` / `const description =`),
// built ONCE here from the same template so RP-5 compares the whole string.
function expectedDescription(state: FetchErrorState, reportContext?: string) {
  return (
    `An error occurred (code: ${state.code}).\n\n` +
    `Message shown: ${state.message}\n\n` +
    (reportContext ? `Where: ${reportContext}\n\n` : '') +
    'What I was doing when this happened:\n\n' +
    'Anything else worth noting:\n'
  );
}

type HarnessProps = {
  failed: boolean;
  state: FetchErrorState;
  withTarget?: boolean;
  reportSubject?: string;
  reportContext?: string;
};

// A section on a page: the banner sits under the section heading, which it passes as focusTarget.
function Harness({ failed, state, withTarget = true, reportSubject, reportContext }: HarnessProps) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  return (
    <main>
      <h1>Page</h1>
      <section>
        <h2 ref={headingRef}>Schedules</h2>
        {failed ? (
          <FetchErrorBanner
            state={state}
            title={LIST_TITLE}
            reportSubject={reportSubject}
            reportContext={reportContext}
            focusTarget={withTarget ? headingRef : undefined}
          />
        ) : (
          <p>ok</p>
        )}
      </section>
    </main>
  );
}

function hosted(ui: React.ReactElement) {
  return <FeedbackModalProvider>{ui}</FeedbackModalProvider>;
}

function formFields(dialog: HTMLElement) {
  return {
    subject: within(dialog).getByRole('textbox', { name: /Subject/ }) as HTMLInputElement,
    description: within(dialog).getByRole('textbox', { name: /Description/ }) as HTMLTextAreaElement,
  };
}

async function openReport(user: ReturnType<typeof userEvent.setup>, index = 0) {
  await user.click(screen.getAllByRole('button', { name: 'Report this' })[index]);
  return screen.findByRole('dialog', { name: DIALOG_NAME });
}

// Between legs of one arm: let a torn-down banner's queued unmount final check (plan 04's hook
// runs it in a microtask) land BEFORE the next leg renders, then put focus back on the body. Without
// it, a leg that ended with focus on Try again (whose own focus watch re-arms) floors focus onto
// the NEXT leg's freshly rendered page heading.
async function settleBetweenLegs() {
  await act(async () => {});
  (document.activeElement as HTMLElement | null)?.blur();
}

/** Dispatch a visibilitychange with the document visible (the hook's tab-return re-attempt). */
function fireVisible() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('the report form outlives the banner (plan 88.6.1-69)', () => {
  it('RP-1. a caller recovery while the person types keeps the form and every typed character', async () => {
    const user = userEvent.setup();
    const state = failedState();
    const { rerender } = render(hosted(<Harness failed state={state} />));
    const dialog = await openReport(user);
    const { subject, description } = formFields(dialog);
    const prefill = description.value;
    const subjectAtOpen = subject.value;
    await user.type(description, TYPED);
    expect(description.value).toBe(prefill + TYPED);

    // The data loads: the caller removes the banner.
    rerender(hosted(<Harness failed={false} state={state} />));
    await screen.findByText('ok');
    expect(screen.queryByRole('button', { name: 'Try again' }), 'the banner is gone').toBeNull();
    const still = screen.getByRole('dialog', { name: DIALOG_NAME });
    expect(formFields(still).description.value).toBe(prefill + TYPED);
    expect(formFields(still).subject.value).toBe(subjectAtOpen);
  });

  it('RP-2. a tab-return recovery while the person types keeps the form and the text', async () => {
    const user = userEvent.setup();
    function LiveHost() {
      const [error, setError] = React.useState<unknown>(new ApiError('first', 'network', 0));
      const calls = React.useRef(0);
      const refetch = React.useCallback(async () => {
        calls.current += 1;
        if (calls.current === 1) {
          setError(new ApiError('second', 'network', 0));
          return { isError: true };
        }
        setError(null);
        return { isError: false };
      }, []);
      const state = useFetchErrorState({ isError: Boolean(error), error, refetch } as unknown as UseQueryResult);
      return (
        <main>
          <h1>Page</h1>
          {state.showError ? <FetchErrorBanner state={state} title={LIST_TITLE} /> : <p>ok</p>}
        </main>
      );
    }
    render(hosted(<LiveHost />));
    // A person retry fails first, so the link exists.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const dialog = await openReport(user);
    const { description } = formFields(dialog);
    const prefill = description.value;
    await user.type(description, TYPED);

    // The hook's automatic re-attempt on tab return recovers the data.
    await act(async () => {
      fireVisible();
    });
    await screen.findByText('ok');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    const still = screen.getByRole('dialog', { name: DIALOG_NAME });
    expect(formFields(still).description.value).toBe(prefill + TYPED);
  });

  it('RP-3. after a recovery, closing the form lands on the banner focusTarget, else the page heading, never body', async () => {
    const user = userEvent.setup();
    const state = failedState();
    const { rerender, unmount } = render(hosted(<Harness failed state={state} />));
    await openReport(user);
    rerender(hosted(<Harness failed={false} state={state} />));
    await screen.findByText('ok');
    await user.keyboard('{Escape}');
    const heading = screen.getByRole('heading', { name: 'Schedules' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull();
    unmount();
    await settleBetweenLegs();

    // No focusTarget: plan 20's floor, the page h1.
    const second = render(hosted(<Harness failed state={state} withTarget={false} />));
    await openReport(user);
    second.rerender(hosted(<Harness failed={false} state={state} withTarget={false} />));
    await screen.findByText('ok');
    await user.keyboard('{Escape}');
    const pageHeading = screen.getByRole('heading', { level: 1, name: 'Page' });
    await waitFor(() => expect(document.activeElement).toBe(pageHeading));
  });

  it('RP-4. with the banner still there, closing the form returns focus to Report this', async () => {
    const user = userEvent.setup();
    render(hosted(<Harness failed state={failedState()} />));
    await openReport(user);
    await user.keyboard('{Escape}');
    const report = screen.getByRole('button', { name: 'Report this' });
    await waitFor(() => expect(document.activeElement).toBe(report));
    expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull();
  });

  it('RP-5. the prefill is unchanged: subject and the whole description composition', async () => {
    const user = userEvent.setup();
    const state = failedState();
    const { unmount } = render(hosted(<Harness failed state={state} />));
    let dialog = await openReport(user);
    expect(formFields(dialog).subject.value).toBe(`Couldn't load: ${state.message}`);
    expect(formFields(dialog).description.value).toBe(expectedDescription(state));
    unmount();

    const context = 'schedules — patterns fetch';
    render(hosted(<Harness failed state={state} reportSubject="Schedules broke" reportContext={context} />));
    dialog = await openReport(user);
    expect(formFields(dialog).subject.value).toBe('Schedules broke');
    expect(formFields(dialog).description.value).toBe(expectedDescription(state, context));
  });

  it('RP-6. two banners on one page open ONE form, carrying the pressed banner subject', async () => {
    const user = userEvent.setup();
    render(
      hosted(
        <main>
          <h1>Page</h1>
          <FetchErrorBanner state={failedState()} title="First" reportSubject="first banner" />
          <FetchErrorBanner state={failedState()} title="Second" reportSubject="second banner" />
        </main>
      )
    );
    const dialog = await openReport(user, 1);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(formFields(dialog).subject.value).toBe('second banner');
  });

  it('RP-7. no host, no dead link: a bare banner with a failed retry renders no Report this', () => {
    render(<FetchErrorBanner state={failedState()} title={LIST_TITLE} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report this' })).toBeNull();
  });

  it('RP-8. every open is a fresh form: a reopen, and a second request while one is open, show only the new prefill', async () => {
    const user = userEvent.setup();
    const state = failedState();
    const opener: { current: ((r: FeedbackHost.ReportRequest) => void) | null } = { current: null };
    function Opener() {
      opener.current = FeedbackHost.useFeedbackReport();
      return null;
    }
    render(
      hosted(
        <>
          <Opener />
          <Harness failed state={state} />
        </>
      )
    );
    let dialog = await openReport(user);
    const prefill = formFields(dialog).description.value;
    await user.type(formFields(dialog).description, TYPED);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull());
    dialog = await openReport(user);
    expect(formFields(dialog).description.value).toBe(prefill);

    // A second request while a form is open replaces it with a fresh one (the per-open key).
    await user.type(formFields(dialog).description, TYPED);
    act(() => {
      opener.current!({ subject: 'another', description: 'another prefill' });
    });
    await waitFor(() => expect(formFields(screen.getByRole('dialog', { name: DIALOG_NAME })).subject.value).toBe('another'));
    expect(formFields(screen.getByRole('dialog', { name: DIALOG_NAME })).description.value).toBe('another prefill');
  });

  it('RP-9. the focused Report this leaving: Try again when the banner stays, else focusTarget, never body (C12 b)', async () => {
    const state = failedState();
    // (i) the caller recovery unmounts the whole banner while Report this holds focus.
    const first = render(hosted(<Harness failed state={state} />));
    const heading = screen.getByRole('heading', { name: 'Schedules' });
    act(() => screen.getByRole('button', { name: 'Report this' }).focus());
    first.rerender(hosted(<Harness failed={false} state={state} />));
    await waitFor(() => expect(document.activeElement, '(i)').toBe(heading));
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    await settleBetweenLegs();

    // (ii) the banner stays; only the link leaves (retryFailed falls while showError stays).
    const second = render(hosted(<Harness failed state={state} />));
    act(() => screen.getByRole('button', { name: 'Report this' }).focus());
    second.rerender(hosted(<Harness failed state={{ ...state, retryFailed: false }} />));
    const again = screen.getByRole('button', { name: 'Try again' });
    await waitFor(() => expect(document.activeElement, '(ii)').toBe(again));
    second.unmount();
    await settleBetweenLegs();

    // (iii) the same with no focusTarget: Try again, never main h1.
    const third = render(hosted(<Harness failed state={state} withTarget={false} />));
    act(() => screen.getByRole('button', { name: 'Report this' }).focus());
    third.rerender(hosted(<Harness failed state={{ ...state, retryFailed: false }} withTarget={false} />));
    const again3 = screen.getByRole('button', { name: 'Try again' });
    await waitFor(() => expect(document.activeElement, '(iii)').toBe(again3));
  });

  it('RP-10. a banner inside an open dialog: the report form stacks above it and closes back into it', async () => {
    const user = userEvent.setup();
    const state = failedState();
    function InDialog({ showBanner }: { showBanner: boolean }) {
      return (
        <main>
          <h1>Page</h1>
          <Modal open onClose={() => {}}>
            <Modal.Header>Members</Modal.Header>
            <Modal.Body>
              {showBanner ? <FetchErrorBanner state={state} title="Couldn't load members" /> : <p>members ok</p>}
            </Modal.Body>
          </Modal>
        </main>
      );
    }
    const { rerender } = render(hosted(<InDialog showBanner />));
    await openReport(user);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull());
    const members = screen.getByRole('dialog', { name: 'Members' });
    expect(members).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Report this' })));

    // Second leg: the banner leaves while the form is open; closing floors to the Members title.
    await openReport(user);
    rerender(hosted(<InDialog showBanner={false} />));
    await screen.findByText('members ok');
    expect(screen.getByRole('dialog', { name: DIALOG_NAME })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: DIALOG_NAME })).toBeNull());
    const title = within(screen.getByRole('dialog', { name: 'Members' })).getByRole('heading', { name: 'Members' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('RP-11. the banner never re-renders when the feedback button opens or closes its modal (review #150)', async () => {
    const control: { current: ReturnType<typeof useFeedbackModal> | null } = { current: null };
    function FeedbackProbe() {
      control.current = useFeedbackModal();
      return null;
    }
    let bannerCommits = 0;
    const onRender = () => {
      bannerCommits += 1;
    };
    const state = failedState();
    render(
      hosted(
        <>
          <FeedbackProbe />
          <main>
            <h1>Page</h1>
            <React.Profiler id="banner" onRender={onRender}>
              <FetchErrorBanner state={state} title={LIST_TITLE} />
            </React.Profiler>
          </main>
        </>
      )
    );
    expect(screen.getByRole('button', { name: 'Report this' })).toBeInTheDocument();
    const before = bannerCommits;
    act(() => control.current!.open(null));
    await waitFor(() => expect(control.current!.isOpen).toBe(true));
    act(() => control.current!.close());
    await waitFor(() => expect(control.current!.isOpen).toBe(false));
    expect(bannerCommits - before, 'banner commits caused by the feedback button').toBe(0);
  });
});
