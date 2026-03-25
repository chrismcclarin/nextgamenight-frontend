import { Inter } from 'next/font/google'
import './globals.css'
import Header from './Header.js'
import Footer from './components/Footer'
import FeedbackButton from './components/FeedbackButton'
import { UserProvider } from '@auth0/nextjs-auth0/client';
import TutorialProvider from './components/tutorial/TutorialProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Next Game Night',
  description: 'Schedule game nights, track board game sessions, and keep your group connected.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <UserProvider>
        <body className={inter.className}>
          <TutorialProvider>
            <Header />
            <main className="min-h-screen">
              {children}
            </main>
            <Footer />
            <FeedbackButton />
          </TutorialProvider>
        </body>
      </UserProvider>
    </html>
  )
}
