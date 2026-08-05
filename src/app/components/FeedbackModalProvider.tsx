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
 * recorded and focus returns to it on `close()`, T-87.8-22). This lets the
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
  setCategory: Dispatch<SetStateAction<FeedbackCategory>>;
}

const FeedbackModalContext = createContext<FeedbackModalContextValue>({
  isOpen: false,
  category: 'General',
  open: () => {},
  close: () => {},
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
    if (invokerRef.current && typeof invokerRef.current.focus === 'function') {
      invokerRef.current.focus();
    }
    invokerRef.current = null;
  }, []);

  // Memoized so the context value keeps a stable identity across provider
  // renders that don't change the transition state — consumers (Header, both
  // FeedbackButton instances) only re-render on an actual open/close/category
  // change, never on unrelated parent renders.
  const value = useMemo<FeedbackModalContextValue>(
    () => ({ isOpen, category, open, close, setCategory }),
    [isOpen, category, open, close],
  );

  return (
    <FeedbackModalContext.Provider value={value}>
      {children}
    </FeedbackModalContext.Provider>
  );
}

export default FeedbackModalProvider;
