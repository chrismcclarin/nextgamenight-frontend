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
  type SetStateAction,
} from 'react';
import { usePathname } from 'next/navigation';

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
 * (Header.js:176). The row tap closes the menu in the SAME transition that opens
 * the modal, so a modal rendered inside that subtree would open inert. Moving
 * the modal into the Header is a decision, not a cleanup.
 *
 * Deliberately does NOT own `text` / `error` / `submitted`: those stay LOCAL
 * to the modal-owning FeedbackButton instance so a keystroke in the textarea
 * never re-renders every context consumer (Header included). Both entry
 * points (desktop FAB, phone nav row) call the same `open()` and therefore
 * produce the identical transition: category re-seeded from the current
 * pathname, and the modal resets its local form state on that transition
 * (T-87.8-20).
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

  return (
    <FeedbackModalContext.Provider value={value}>
      {children}
    </FeedbackModalContext.Provider>
  );
}

export default FeedbackModalProvider;
