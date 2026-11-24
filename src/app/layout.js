import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import Header from './Header.js'
import Footer from './components/Footer'
import FeedbackButton from './components/FeedbackButton'
import { UserProvider } from '@auth0/nextjs-auth0/client';
import { Toaster } from 'sonner'
import Providers from './providers'
import AppErrorBoundary from './components/AppErrorBoundary'
import TutorialProvider from './components/tutorial/TutorialProvider'
import TimezoneProvider from './components/TimezoneProvider'
import ThemeProvider from './components/ThemeProvider'
import FriendshipStatusProvider from './components/FriendshipStatusProvider'
import UnreadNotificationProvider from './components/UnreadNotificationProvider'
import FeedbackModalProvider from './components/FeedbackModalProvider'
import { RootAnnouncer } from '../components/ui/RootAnnouncer'
import { ToastAnnouncer } from '../components/ui/ToastAnnouncer'

const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ['latin'] })

export const metadata = {
  title: 'Next Game Night',
  description: 'Schedule game nights, track board game sessions, and keep your group connected.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <UserProvider>
        <body className={plusJakartaSans.className}>
          {/* GUARD-01 (Plan 86-08, D-07): AppErrorBoundary wraps the entire
              provider stack INSIDE <body> so a render-time throw in any
              provider degrades to a styled fallback (keeps shell/theme/fonts)
              and auto-reports to Sentry — never a white screen. global-error.tsx
              is the bare last-resort net for throws in the layout itself. */}
          <AppErrorBoundary>
          {/* GUARD-02 (Plan 86-08, D-08): exactly ONE sonner <Toaster/> mounted
              at the root layout (NOT per-route — the G2 check) providing the
              transient failure-visibility substrate. Has built-in aria-live. */}
          {/* DECISION Phase 88.9-24 (owner ruling 88.9-RULINGS.md R-F1 (2026-11-08)): ONE
              always-mounted sr-only polite region, fed by the module store in
              src/components/ui/announcer.ts, speaks the outcomes that rule 2 no longer toasts —
              chosen OVER a React context (this layout is a server component and this region sits
              outside the children and every provider) and OVER a per-component region (createEvent
              and GroupSettings unmount on close). It preserves a behaviour that already ships (the
              Toaster's live region spoke these words), not a new capability (P4). Changing this is
              a decision, not a cleanup.
              AMENDED Phase 88.9-52 (A-47): this root region is not heard on an iPhone while a house
              dialog is open (measured 2026-11-16), so while one is open the same store hands the
              words to a region inside that dialog and this one stays empty
              (src/components/ui/announcer.ts ("DECISION Phase 88.9-52 (A-47): while a house dialog is open")).
              The mount here is unchanged.
              AMENDED Phase 89.6-03 (toast-bridge): the outcomes are no longer the only words that
              reach an open dialog. ToastAnnouncer, mounted beside this region, hands a toast's
              words to the open dialog's region through the same store
              (src/components/ui/announcer.ts ("DECISION Phase 89.6-03 (toast-bridge)")).
              It is not a Toaster (GUARD-02 still holds) and renders no node. This region's mount
              is unchanged. */}
          {/* DECISION Phase 88.9-52 (W40, owner at the after-build look page: the error toast lies
              over the header and its close x overlaps the logo on a phone): on a phone (Sonner's
              600px and under) the toast starts 72px from the top, the 64px header strip plus an
              8px gap, chosen OVER Sonner's default 16px (inside the sticky strip, with the close
              button on the logo) and OVER moving phone toasts to the bottom (the phone bottom bar
              and the keyboard live there). Only the top is given, so the 16px side gutters stay
              Sonner's own. The desktop position is unchanged. The number follows the strip's
              height at src/app/Header.js ("w-full h-16 bg-surface-header border-b border-line-strong"); pinned by
              src/app/miniPicks.test.ts ("8. 88.9-52 W40"). */}
          <Toaster position="top-right" richColors closeButton theme="system" mobileOffset={{ top: 72 }} />
          <RootAnnouncer />
          <ToastAnnouncer />
          {/* PRIM-07 (Plan 84-04): TanStack Query provider mounted at the app
              root via the server-fresh / browser-singleton getQueryClient()
              factory. Must sit ABOVE any component that calls useQuery. */}
          <Providers>
          <ThemeProvider>
            <TimezoneProvider>
              <TutorialProvider>
                {/* POLL-02: FriendshipStatusProvider lifted to root so the
                    NotificationBell (in Header) and friends/page consume the
                    same receivedRequests array. Inner page-level mounts on
                    gameDetail / groupHomePage / grouplist were removed in
                    the same commit so their nested instances no longer
                    shadow the root state. */}
                <FriendshipStatusProvider>
                  {/* MOB-08 (Plan 77-01): single source of truth for the
                      unread notification count. Wraps Header + content so
                      the in-menu NotificationBell badge AND the mobile
                      hamburger dot read the same totalCount. Must nest
                      INSIDE FriendshipStatusProvider since the unread
                      count includes received friend requests. */}
                  <UnreadNotificationProvider>
                    {/* MOB-04 (Plan 87.8-05, D-09): feedback modal open/close
                        transition owner. Wraps BOTH Header and FeedbackButton
                        so the phone nav "Send feedback" row (in Header) and
                        the desktop FAB drive the SAME modal instance. The
                        modal itself stays mounted HERE at the layout root
                        (the <FeedbackButton /> below) — never inside the
                        header dropdown. Originally that was a containing-block
                        hazard: the dropdown's computed `translate` would
                        capture a position:fixed overlay. Phase 88-17 (Req 9)
                        moved the modal onto the shared, PORTALLED <Modal>, so
                        that specific hazard is gone — but the mount point does
                        NOT move, because the dropdown's closed state carries
                        `pointer-events-none` (src/app/Header.js ("-translate-y-full opacity-0 pointer-events-none")) and a modal
                        rendered there would open inert. See
                        FeedbackModalProvider.tsx for the full record. */}
                    <FeedbackModalProvider>
                      {/* 87.8-13 walkthrough F-10: classic sticky footer — the
                          WRAPPER is viewport-tall and main grows to fill, so on
                          sparse pages (one group, empty states) the footer sits at
                          the bottom edge of the first screen instead of a full
                          scroll below it. The old shape (min-h-screen on main
                          alone) forced total height to 100vh + header + footer on
                          EVERY page. Tall pages render identically. The wrapper is
                          a plain div with no transform/filter, so it does NOT
                          become a containing block for the fixed-position modal
                          overlay or FAB (the D-09 constraint above). */}
                      <div className="min-h-screen flex flex-col">
                        <Header />
                        {/* DECISION Phase 88.9-58 (X20, owner at N09, 2026-11-11: yes hide it): main hides the
                            browser outline because it is only a programmatic focus target (the page floor),
                            never a Tab stop (2.4.7 reading in 88.9-58-SUMMARY; GOV.UK ships the same). Chosen
                            OVER the frame round the page and OVER a global reset (heading floors keep their
                            ring); outline-hidden over outline none for forced-colors. If main becomes a Tab
                            stop, this must go. */}
                        <main className="flex-1 focus:outline-hidden">
                          {children}
                        </main>
                        <Footer />
                      </div>
                      <FeedbackButton />
                    </FeedbackModalProvider>
                  </UnreadNotificationProvider>
                </FriendshipStatusProvider>
              </TutorialProvider>
            </TimezoneProvider>
          </ThemeProvider>
          </Providers>
          </AppErrorBoundary>
        </body>
      </UserProvider>
    </html>
  )
}
