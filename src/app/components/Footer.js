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
            
            {/* Feedback Button */}
            <button
              onClick={() => setShowFeedbackForm(true)}
              className="text-sm text-gray-600 hover:text-gray-900 underline transition-colors"
              aria-label="Report bug or suggest feature"
            >
              Report Bug or Suggest Feature
            </button>
            
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


