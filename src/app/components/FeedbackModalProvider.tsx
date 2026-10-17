'use client';
import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useMemo,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { usePathname } from 'next/navigation';
import FeedbackForm from './FeedbackForm';
import { focusElement } from '@/components/ui/focusPageFloor';

/**
 * Feedback modal open/close transition — single source of truth (MOB-04, Plan 87.8-05, D-09).
 *
 * Owns ONLY the open/close TRANSITION state: `isOpen`, the pathname-derived
 * `category` seed, and focus management (the element that invoked `open()` is
 * recorded and focus returns to it via the modal's `onCloseAutoFocus`,
 * T-87.8-22). This lets the
 * TRIGGER live in the Header (the mobile nav "Send feedback" row) while the
 * modal itself stays mounted at the layout root.
 *
 * Phase 88-17 (Req 9) moved that modal from the hand-rolled `.modal-overlay`
 * markup onto the shared `<Modal>` primitive, which portals to `<body>`. That
 * retires the ORIGINAL reason for the split — RESEARCH Pitfall 1, where the
 * header dropdown's computed `translate` became the containing block for a
 * position:fixed overlay and clipped it to the dropdown's height. A portalled
 * dialog cannot hit that. The split is still load-bearing for a SECOND, verified
 * reason, which is why it stays: the dropdown is rendered unconditionally and
 * hidden by class toggle, and its closed state carries `pointer-events-none`
 * (the closed mobile menu's class list in `src/app/Header.js`). The row tap
 * closes the menu in the SAME transition that opens the modal, so a modal
 * rendered inside that subtree would open inert. Moving
 * the modal into the Header is a decision, not a cleanup.
 *
 * Deliberately does NOT own `text` / `error` / `submitted`: those stay LOCAL
 * to the modal-owning FeedbackButton instance so a keystroke in the textarea
 * never re-renders every context consumer (Header included). Both entry
 * points (desktop FAB, phone nav row) call the same `open()` and therefore
 * produce the identical transition: category re-seeded from the current
 * pathname, and the modal resets its local form state on that transition
 * (T-87.8-20).
 *
 * AMENDED Phase 88.6.1-69: the provider now ALSO hosts the Report Bug form a
 * `FetchErrorBanner` opens (one instance for every banner on the page), so a
 * recovery that removes the banner (the error hook's tab-return re-attempt, or
 * a caller that unmounts it when its data loads) cannot take the open form and
 * the person's typed report with it. It exposes `openReport` on its OWN context
 * (`useFeedbackReport()`), so no banner subscribes to the feedback button's
 * state. It still owns no typed text: the form keeps that locally, as above.
 */

export type FeedbackCategory =
  | 'General'
  | 'Groups'
  | 'Friends List'
  | 'Scheduling'
  | 'Home'
  | 'Games'
  | 'Profile';

interface CategoryMapEntry {
  pattern: RegExp;
  category: FeedbackCategory;
  label: string;
}

// Category mapping moved here from FeedbackButton.js (Plan 87.8-05): the
// pathname → category seed is part of the open transition this provider owns.
// FeedbackButton imports CATEGORIES / getCategoryLabel back for its form.
const CATEGORY_MAP: CategoryMapEntry[] = [
  { pattern: /^\/groups/,        category: 'Groups',       label: 'feedback:groups' },
  { pattern: /^\/groupHomePage/, category: 'Groups',       label: 'feedback:groups' },
  { pattern: /^\/friends/,       category: 'Friends List', label: 'feedback:friends-list' },
  { pattern: /^\/groupPlanning/, category: 'Scheduling',   label: 'feedback:scheduling' },
  { pattern: /^\/userHome/,      category: 'Home',         label: 'feedback:home' },
  { pattern: /^\/gameDetail/,    category: 'Games',        label: 'feedback:games' },
  { pattern: /^\/userProfile/,   category: 'Profile',      label: 'feedback:profile' },
];

export const CATEGORIES: FeedbackCategory[] = ['General', 'Groups', 'Friends List', 'Scheduling', 'Home', 'Games', 'Profile'];

export function getCategoryLabel(category: string): string {
  const match = CATEGORY_MAP.find((entry) => entry.category === category);
  return match ? match.label : 'feedback:general';
}

export function mapPathnameToCategory(pathname: string | null | undefined): FeedbackCategory {
  if (!pathname) return 'General';
  const match = CATEGORY_MAP.find((entry) => entry.pattern.test(pathname));
  return match ? match.category : 'General';
}

interface FeedbackModalContextValue {
  isOpen: boolean;
  category: FeedbackCategory;
  open: (invoker?: HTMLElement | null) => void;
  close: () => void;
  /** Wire onto the modal's `onCloseAutoFocus` — see the note on `close`. */
  onCloseAutoFocus: (event: Event) => void;
  setCategory: Dispatch<SetStateAction<FeedbackCategory>>;
}

const FeedbackModalContext = createContext<FeedbackModalContextValue>({
  isOpen: false,
  category: 'General',
  open: () => {},
  close: () => {},
  onCloseAutoFocus: () => {},
  setCategory: () => {},
});

export function useFeedbackModal(): FeedbackModalContextValue {
  return useContext(FeedbackModalContext);
}

/** What a banner's `Report this` hands the host: the prefill, and where focus goes on close. */
export type ReportRequest = {
  subject: string;
  description: string;
  /** The `Report this` button that opened the form (Safari does not focus a clicked button). */
  invoker?: HTMLElement | null;
  /** The banner's `focusTarget`, tried when the invoker has gone. */
  fallback?: RefObject<HTMLElement | null>;
};

// DECISION Phase 88.6.1-69 (report context split): `openReport` rides its OWN context whose value is only that stable function, REJECTED as a member of the feedback context because that value changes identity on every feedback-button open / close, category pick and route change (its deps `[isOpen, category, open, close, onCloseAutoFocus]`, `open` rebuilt on `[pathname]`), so every banner would re-render on each.
const FeedbackReportContext = createContext<((request: ReportRequest) => void) | null>(null);

/** The app-level report host's `openReport`, or `null` outside the provider (no host, no link). */
export function useFeedbackReport(): ((request: ReportRequest) => void) | null {
  return useContext(FeedbackReportContext);
}

export function FeedbackModalProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('General');

  // The control (FAB or nav row) that invoked open(); close() returns focus to
  // it (T-87.8-22). Callers pass the element explicitly (e.currentTarget)
  // rather than this reading document.activeElement, because Safari does not
  // focus buttons on click — activeElement would be <body> there.
  const invokerRef = useRef<HTMLElement | null>(null);

  const open = useCallback((invoker?: HTMLElement | null) => {
    invokerRef.current = invoker ?? null;
    // ONE transition, both halves together: isOpen AND the pathname-derived
    // category seed. Lifting isOpen alone would open the modal with whatever
    // category its instance had left over from a previous open (T-87.8-20).
    setCategory(mapPathnameToCategory(pathname));
    setIsOpen(true);
  }, [pathname]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // The T-87.8-22 restore lives HERE, not in close(): since 88-17 hosted the
  // modal on <Modal> (Radix), Radix moves focus after the dialog unmounts, so a
  // restore performed inside close() ran first and was then clobbered — the FAB
  // ended up unfocused (caught by feedback-stacking.spec.ts in the first CI
  // run). preventDefault() only when there is an invoker to restore to; with
  // none, Radix's default is the right fallback.
  //
  // AMENDED Phase 88.3-17 (T-88.3-80), premise re-verified, restore location
  // UNCHANGED: the order of the two calls is now load-bearing and must not be
  // "tidied" back. Since 88.3-17 the phone entry point restores to the hamburger
  // toggle (owner ruling 6 / DEF-88.3-12-01), and that toggle is `md:hidden`
  // (`Header.js`). If the viewport crosses the `md` breakpoint while the modal is
  // open — a tablet rotated past 768px — the toggle computes `display: none`,
  // `focus()` is a silent no-op, and the old order had ALREADY called
  // preventDefault(), suppressing Radix's own fallback: focus landed on <body>
  // and the keyboard user was stranded. So: focus FIRST, then prevent the
  // default ONLY if the focus actually landed. On the failure path the event
  // stays unprevented and Radix runs its own fallback — which, honestly stated
  // (88.3 code-adversarial-review run 4, 2026-08-28), is `previouslyFocusedElement
  // ?? document.body`; the previously-focused nav row is inside the panel
  // `Header.js` marks inert and is itself `md:hidden` past the breakpoint, so on
  // that path focus still lands on <body>. The reorder does not RECOVER that
  // tablet-rotation edge case; it stops the common path from being made worse. This is a strict
  // improvement on the FAB path too — the FAB is always focusable, so the guard
  // never fires there. Reordering these two lines, or dropping the
  // `document.activeElement` check, is a decision, not a cleanup.
  //
  // AMENDED Phase 88.6.1-20 (D-07): the unprevented path above is no longer
  // Radix's fallback — since 88.6-44 it is `Modal`'s own restore, and since
  // 88.6.1-20 that restore FLOORS (`restoreDialogFocus` in
  // `components/ui/dialog.tsx`). So the tablet-rotation case now lands on the
  // page's main heading (or `main`), not on <body>. The focus-first,
  // prevent-only-if-landed order is still load-bearing, and now for a second
  // reason: preventing early would skip the primitive's floor.
  const onCloseAutoFocus = useCallback((event: Event) => {
    const invoker = invokerRef.current;
    invokerRef.current = null;
    if (invoker && typeof invoker.focus === 'function') {
      invoker.focus();
      if (document.activeElement === invoker) event.preventDefault();
    }
  }, []);

  // Memoized so the context value keeps a stable identity across provider
  // renders that don't change the transition state — consumers (Header, both
  // FeedbackButton instances) only re-render on an actual open/close/category
  // change, never on unrelated parent renders.
  const value = useMemo<FeedbackModalContextValue>(
    () => ({ isOpen, category, open, close, onCloseAutoFocus, setCategory }),
    [isOpen, category, open, close, onCloseAutoFocus],
  );

  /* DECISION Phase 88.6.1-69 (report form outlives the banner): the Report Bug form a banner
     opens is hosted HERE, at the layout root, so a recovery that removes the banner (the error
     hook's tab-return re-attempt, or any caller that unmounts it when its data loads) cannot take
     the form and the person's typed report with it. The text stays the form's local state (this
     provider's no-text rule above); each open gets a new `key`, so every open is a fresh form;
     focus on close goes to the opener, else the banner's `focusTarget`, else the primitive's floor.
     REJECTED: (b) holding the banner mounted while a report is open — every full mount is
     caller-gated, so the hook would have to report a failure after the data loaded ("Couldn't
     load…" over loaded content, SPEC Prohibition 2) and the recovered content would stay hidden;
     (c) suspending the tab-return re-attempt while the form is open — a caller-driven recovery
     still unmounts the banner; (d) the feedback button's own modal — a different form and channel
     with no prefill, so the report would change destination; (e) moving the Footer's instance here
     too — it has no defect (the Footer never unmounts on a data recovery) and it is outside this
     fix. Moving the report form back into the banner is a decision, not a cleanup. */
  const [report, setReport] = useState<{ key: number; subject: string; description: string } | null>(null);
  const reportRequestRef = useRef<ReportRequest | null>(null);
  const reportKeyRef = useRef(0);

  const openReport = useCallback((request: ReportRequest) => {
    reportRequestRef.current = request;
    reportKeyRef.current += 1;
    setReport({ key: reportKeyRef.current, subject: request.subject, description: request.description });
  }, []);

  const closeReport = useCallback(() => setReport(null), []);

  // The report form's close restore, written BELOW the feedback button's on purpose (that one's
  // order is pinned by first occurrence). The opener when still connected, else the banner's
  // focusTarget, each outcome-checked through plan 04's `focusElement`; prevent the default only
  // when one landed, so `Modal`'s own restore (plan 20's floor) runs otherwise.
  const reportOnCloseAutoFocus = useCallback((event: Event) => {
    const request = reportRequestRef.current;
    reportRequestRef.current = null;
    if (focusElement(request?.invoker) || focusElement(request?.fallback?.current)) {
      event.preventDefault();
    }
  }, []);

  return (
    <FeedbackModalContext.Provider value={value}>
      <FeedbackReportContext.Provider value={openReport}>
        {children}
        {report ? (
          <FeedbackForm
            key={report.key}
            initialType="bug"
            initialSubject={report.subject}
            initialDescription={report.description}
            onClose={closeReport}
            onCloseAutoFocus={reportOnCloseAutoFocus}
          />
        ) : null}
      </FeedbackReportContext.Provider>
    </FeedbackModalContext.Provider>
  );
}

export default FeedbackModalProvider;
