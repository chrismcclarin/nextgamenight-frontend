'use client';
import { useState } from 'react';
import FeedbackForm from './FeedbackForm';
import BGGLogo from './BGGLogo';

export default function Footer() {
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);

  return (
    <>
      <footer className="bg-white border-t border-gray-200 py-4 mt-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            {/* BGG Logo */}
            <div className="flex-shrink-0">
              <BGGLogo />
            </div>
            
            {/* Links */}
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <a href="/privacy" className="hover:text-gray-900 underline transition-colors">Privacy Policy</a>
              <a href="/terms" className="hover:text-gray-900 underline transition-colors">Terms of Service</a>
              <button
                onClick={() => setShowFeedbackForm(true)}
                className="hover:text-gray-900 underline transition-colors"
                aria-label="Report bug or suggest feature"
              >
                Report Bug
              </button>
            </div>

            {/* Copyright */}
            <p className="text-sm text-gray-500 text-center md:text-right">
              © {new Date().getFullYear()} Next Game Night
            </p>
          </div>
        </div>
      </footer>
      
      {showFeedbackForm && (
        <FeedbackForm onClose={() => setShowFeedbackForm(false)} />
      )}
    </>
  );
}


