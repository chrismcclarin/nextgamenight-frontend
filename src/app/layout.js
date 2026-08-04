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
          <Toaster position="top-right" richColors closeButton theme="system" />
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
                        header dropdown, whose computed `translate` would
                        capture a position:fixed .modal-overlay as its
                        containing block. */}
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
                        <main className="flex-1">
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
