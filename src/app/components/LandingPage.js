'use client';

import BGGLogo from './BGGLogo';
import DieLogo from './DieLogo';

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col">

      {/* Hero */}
      <div className="bg-emerald-900 text-white py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-8">
            <DieLogo size={80} />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
            Your next game night<br className="hidden sm:block" /> starts here.
          </h1>
          <p className="text-xl text-emerald-200 mb-10 max-w-2xl mx-auto">
            Schedule sessions, track what you&apos;ve played, and keep your whole group in the loop — all in one place.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="/api/auth/login"
              className="bg-amber-500 hover:bg-amber-400 text-emerald-900 font-bold px-8 py-4 rounded-lg text-lg shadow-lg hover:shadow-xl transition-all w-full sm:w-auto text-center"
            >
              Get Started Free
            </a>
            <a
              href="/api/auth/login?connection=google-oauth2"
              className="bg-white/10 hover:bg-white/20 border border-white/30 text-white px-8 py-4 rounded-lg text-lg font-semibold transition-all w-full sm:w-auto text-center flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </a>
          </div>
        </div>
      </div>

      {/* Feature cards */}
      <div className="bg-amber-50 flex-1 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-emerald-900 mb-12">
            Everything your group needs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-emerald-100 hover:border-amber-400 hover:shadow-md transition-all">
              <div className="text-4xl mb-4">🎲</div>
              <h3 className="text-xl font-bold mb-2 text-emerald-900">Track Sessions</h3>
              <p className="text-gray-600">
                Record every game night. See when you played, who showed up, and what everyone thought.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-emerald-100 hover:border-amber-400 hover:shadow-md transition-all">
              <div className="text-4xl mb-4">👥</div>
              <h3 className="text-xl font-bold mb-2 text-emerald-900">Gather Your Crew</h3>
              <p className="text-gray-600">
                Create groups, invite friends, and coordinate schedules with automatic availability reminders.
              </p>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-emerald-100 hover:border-amber-400 hover:shadow-md transition-all">
              <div className="text-4xl mb-4">⭐</div>
              <h3 className="text-xl font-bold mb-2 text-emerald-900">Rate &amp; Remember</h3>
              <p className="text-gray-600">
                Review games after you play them. Build your group&apos;s collection of favorites over time.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* BGG attribution footer */}
      <footer className="bg-white border-t border-gray-200 py-4">
        <BGGLogo />
      </footer>
    </div>
  );
}
