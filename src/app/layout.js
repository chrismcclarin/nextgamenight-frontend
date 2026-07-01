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
                    <Header />
                    <main className="min-h-screen">
                      {children}
                    </main>
                    <Footer />
                    <FeedbackButton />
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
