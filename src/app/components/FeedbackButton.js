'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import { feedbackAPI } from '../../lib/api';

const CATEGORY_MAP = [
  { pattern: /^\/groups/,        category: 'Groups',       label: 'feedback:groups' },
  { pattern: /^\/groupHomePage/, category: 'Groups',       label: 'feedback:groups' },
  { pattern: /^\/friends/,       category: 'Friends List', label: 'feedback:friends-list' },
  { pattern: /^\/groupPlanning/, category: 'Scheduling',   label: 'feedback:scheduling' },
  { pattern: /^\/userHome/,      category: 'Home',         label: 'feedback:home' },
  { pattern: /^\/gameDetail/,    category: 'Games',        label: 'feedback:games' },
  { pattern: /^\/userProfile/,   category: 'Profile',      label: 'feedback:profile' },
];

const CATEGORIES = ['General', 'Groups', 'Friends List', 'Scheduling', 'Home', 'Games', 'Profile'];

function getCategoryLabel(category) {
  const match = CATEGORY_MAP.find((entry) => entry.category === category);
  return match ? match.label : 'feedback:general';
}

function mapPathnameToCategory(pathname) {
  if (!pathname) return 'General';
  const match = CATEGORY_MAP.find((entry) => entry.pattern.test(pathname));
  return match ? match.category : 'General';
}

export default function FeedbackButton() {
  const { user } = useUser();
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState('General');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  // Close modal on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Auth guard: invisible when not logged in
  if (!user) return null;

  const handleOpen = () => {
    setCategory(mapPathnameToCategory(pathname));
    setText('');
    setError(null);
    setSubmitted(false);
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (text.trim().length < 10) {
      setError('Feedback must be at least 10 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      await feedbackAPI.submitGitHubFeedback({
        category,
        text: text.trim(),
        pageUrl: window.location.href,
        userName: user.name || user.nickname || 'Unknown',
        userEmail: user.email || '',
        label: getCategoryLabel(category),
        userAgent: navigator.userAgent,
      });

      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setText('');
        setCategory('General');
        setIsOpen(false);
      }, 2000);
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setError(err.message || 'Failed to submit feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating feedback button */}
      <button
        onClick={handleOpen}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        aria-label="Send feedback"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center"
          onClick={handleOverlayClick}
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            {submitted ? (
              /* Success state */
              <div className="text-center py-4">
                <div className="text-green-600 text-5xl mb-4">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-12 h-12 mx-auto text-green-600"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-900">
                  Thanks! Your feedback has been submitted.
                </p>
              </div>
            ) : (
              /* Form state */
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-900">Send Feedback</h2>
                  <button
                    onClick={handleClose}
                    className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                    aria-label="Close"
                  >
                    &times;
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Category dropdown */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Feedback textarea */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Feedback
                    </label>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Tell us what's on your mind..."
                      rows={5}
                      className="w-full p-2 border border-gray-300 rounded-md text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {text.trim().length} characters (10 minimum)
                    </p>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded text-sm">
                      {error}
                    </div>
                  )}

                  {/* Submit */}
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submitting || text.trim().length < 10}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {submitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
