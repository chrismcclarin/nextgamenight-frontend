'use client';

import Link from 'next/link';
import BGGLogo from './BGGLogo';

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Periodic Tabletop
          </h1>
          <p className="text-xl text-gray-700 mb-8">
            Track your board game sessions, connect with friends, and discover your favorite games.
          </p>
          <p className="text-lg text-gray-600 mb-12">
            Log your game nights, see what your group has played, and share your thoughts on each game.
          </p>
          
          <div className="flex flex-col gap-4 justify-center items-center">
            <Link
              href="/api/auth/login"
              className="bg-blue-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl w-full sm:w-auto text-center"
            >
              Get Started
            </Link>
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="flex-1 border-t border-gray-300"></div>
              <span className="text-sm text-gray-600">or</span>
              <div className="flex-1 border-t border-gray-300"></div>
            </div>
            <Link
              href="/api/auth/login?connection=google-oauth2"
              className="bg-white text-gray-700 px-8 py-4 rounded-lg text-lg font-semibold hover:bg-gray-50 transition-colors shadow-lg hover:shadow-xl border-2 border-gray-300 w-full sm:w-auto text-center flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </Link>
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold mb-3 text-gray-900">Track Games</h3>
              <p className="text-gray-600">
                Record every board game session with your group. See when you played, who won, and how everyone scored.
              </p>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold mb-3 text-gray-900">Organize Groups</h3>
              <p className="text-gray-600">
                Create groups with your friends and family. Everyone can add games and share their experiences.
              </p>
            </div>
            
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-xl font-semibold mb-3 text-gray-900">Share Reviews</h3>
              <p className="text-gray-600">
                Rate and review games you've played. See what your group members think about each game.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* BGG Logo Footer - Required for BGG API compliance */}
      <footer className="bg-white border-t border-gray-200 py-4">
        <BGGLogo />
      </footer>
    </div>
  );
}




