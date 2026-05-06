import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import Header from './Header.js'
import Footer from './components/Footer'
import FeedbackButton from './components/FeedbackButton'
import { UserProvider } from '@auth0/nextjs-auth0/client';
import TutorialProvider from './components/tutorial/TutorialProvider'
import TimezoneProvider from './components/TimezoneProvider'
import ThemeProvider from './components/ThemeProvider'
import FriendshipStatusProvider from './components/FriendshipStatusProvider'

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
                  <Header />
                  <main className="min-h-screen">
                    {children}
                  </main>
                  <Footer />
                  <FeedbackButton />
                </FriendshipStatusProvider>
              </TutorialProvider>
            </TimezoneProvider>
          </ThemeProvider>
        </body>
      </UserProvider>
    </html>
  )
}
