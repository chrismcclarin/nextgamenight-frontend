'use client';
import { useState } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import FeedbackForm from './FeedbackForm';
import BGGLogo from './BGGLogo';

// Public/auth footer split via useUser() discriminator.
// - Stable isLoading placeholder mirrors Header.js:43 to avoid SSR/hydration mismatch.
// - Privacy href intentionally uses `/Privacy` (capital P) — required for Google auth
//   integration. Do NOT lowercase. About + Terms can be lowercase.
// - Report Bug button lives only in the auth footer — anonymous visitors aren't reporting
//   bugs; logged-in users hitting friction in their workflow are.
export default function Footer() {
  const { user, isLoading } = useUser();

  /* DECISION Phase 88.1 (Req 11a, owner ruling 2026-08-22): the phone bottom bar's 56px
     clearance is reserved HERE, inside Footer, gated on the bar actually being mounted —
     chosen OVER two alternatives that were considered and rejected:

       - `sticky bottom-0` on the bar instead of `fixed`. Rejected: that changes scroll
         behaviour — the bar would scroll away with the content instead of staying pinned,
         which is the whole point of a persistent phone surface.
       - reserving the space globally at `layout.js:86-91` (D-05's originally cited site).
         Rejected: that pads the bottom of EVERY phone page for a bar that renders on one,
         and `layout.js`'s wrapper must stay untouched so it never becomes a containing
         block for fixed-position overlays (its own comment at :83-85).

     Padding on the PAGE cannot solve this: `<Footer />` is a SIBLING of `<main>`
     (`layout.js:86-91`), rendered after it, so padding inside a page's own root pushes only
     that page's content and leaves the Footer in the fixed bar's path. On a short page the
     sticky-footer wrapper parks the Footer at the viewport bottom — exactly where the bar
     sits — and the bar's stacking tier beats the Footer, which sets no z-index, occluding
     the `/Privacy` link CLAUDE.md records as load-bearing for Google auth.

     Deleting this spacer re-occludes that link, and jsdom cannot see occlusion — the real
     guard is plan 88.1-10's phone e2e.

     EXTENDED Phase 88.1-20 (88.1-REVIEW.md IN-01): the contract is now honoured on ALL THREE
     return paths. The auth-LOADING branch below returned a bare placeholder and dropped the
     spacer — the one hole. Stated honestly, because it matters for what this does and does not
     buy: in the loading state the footer renders no links at all, so closing this hole closes a
     CONTRACT hole, NOT a known user-visible occlusion. Plan 19 measured the occlusion the CI
     case reports and REFUTED this branch as its cause (`spacerPresent: true` and
     `authFooterPresent: true` in every sample, failing attempt included); that failure is a
     scroll race and is fixed in the e2e spec, not here.

     AMENDED Phase 88.5 (SPEC Req 1): THE CLEARANCE IS RETIRED. Every word above stands as the
     record of a real problem — it is retired because THE OCCLUDING ELEMENT IS GONE, not because
     the concern was wrong. Plan 88.5-07 deleted the phone bottom event bar and the sheet it
     opened (SPEC Req 1; the count it carried now rides the home page's Calendar button as an
     amber pill). Re-adding any fixed bottom-edge surface to a phone page re-opens everything
     above and this spacer has to come back with it.

     THE VERIFIED NEGATIVE, re-run across src/ at deletion time (2026-09-01) — a recursive grep
     for elements combining position-fixed with a zero bottom offset (the phrasing is left
     un-quoted on purpose so this note cannot match its own gate; the exact command is in
     `88.5-07-PLAN.md`'s verification block). It now returns exactly ONE production element —
     `ui/BottomSheet.tsx:213`, a Radix dialog that
     portals to <body> and only exists while open, so it can never park over the Footer the way a
     persistent bar did. The capital-P Privacy link that CLAUDE.md records as load-bearing for
     Google auth is therefore unoccludable BY CONSTRUCTION now, rather than by a spacer that had
     to be kept in sync with a sibling component's mount state.

     ALSO RECORDED HERE because its own file is deleted and this was its only reader — the
     phone-bottom-bar presence store's `DECISION Phase 88.1 (plan 08, Task 2)`: that store was a
     module-level external store read through `useSyncExternalStore`, chosen OVER a React context
     provider, because a provider must be an ANCESTOR of both <main> and <Footer /> and the only
     such ancestor is `layout.js:86-91` — which 88.1 was forbidden to touch (the D-05 deviation:
     that wrapper must stay a plain div with no transform/filter so it never becomes a containing
     block for fixed-position overlays, and no global page may reserve 56px for a bar rendering on
     one page). It counted mounts rather than holding a boolean so a remount-before-unmount
     ordering (StrictMode double-invoke, route transitions) could not leave the flag stuck false.
     Anyone rebuilding a phone bottom bar needs both of those constraints, not just the spacer.

     Deleting the store rather than leaving it inert was deliberate: with the bar gone it had zero
     producers and no possible future producer, so the Footer would have been reading a store that
     can never be true, and the surviving tests would have had to construct a synthetic producer to
     exercise a contract nothing implements. The inverted pins in
     `UserHomePage.phone.test.tsx` assert that NO spacer renders on any of the three return paths
     below, so this retirement is held green with intent rather than incidentally. */

  if (isLoading) {
    return <div className="h-12" />;
  }

  if (!user) {
    return <PublicFooter />;
  }
  return <AuthFooter />;
}

function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-surface-page border-t border-line">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-content-muted">
          <div className="flex items-center gap-4">
            <a
              href="/about"
              className="hover:text-content-secondary transition-colors"
            >
              About
            </a>
            <a
              href="/Privacy"
              className="hover:text-content-secondary transition-colors"
            >
              Privacy
            </a>
            <a
              href="/terms"
              className="hover:text-content-secondary transition-colors"
            >
              Terms
            </a>
          </div>
          <div className="flex items-center gap-3">
            <BGGLogo />
            <span>© {year} Next Game Night</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function AuthFooter() {
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const year = new Date().getFullYear();

  return (
    <>
      <footer className="bg-surface-page border-t border-line">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-content-muted">
            <div className="flex items-center gap-4">
              <a
                href="/about"
                className="hover:text-content-secondary transition-colors"
              >
                About
              </a>
              <a
                href="/Privacy"
                className="hover:text-content-secondary transition-colors"
              >
                Privacy
              </a>
              <a
                href="/terms"
                className="hover:text-content-secondary transition-colors"
              >
                Terms
              </a>
              <button
                onClick={() => setShowFeedbackForm(true)}
                className="hover:text-content-secondary transition-colors"
                aria-label="Report bug or suggest feature"
              >
                Report bug
              </button>
            </div>
            <div className="flex items-center gap-3">
              <BGGLogo />
              <span>© {year} Next Game Night</span>
            </div>
          </div>
        </div>
      </footer>

      {showFeedbackForm && (
        <FeedbackForm onClose={() => setShowFeedbackForm(false)} />
      )}
    </>
  );
}
