'use client';
import { useState } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import FeedbackForm from './FeedbackForm';
import BGGLogo from './BGGLogo';

// Public/auth footer split via useUser() discriminator.
// - Stable isLoading placeholder mirrors Header.js:43 to avoid SSR/hydration mismatch.
// - Privacy href intentionally uses `/Privacy` (capital P) — required for Google auth
//   integration. Do NOT lowercase. About + Terms can be lowercase.
// - Public footer keeps the FeedbackForm modal mount; auth footer drops Report Bug
//   (auth-app surfaces have a separate FeedbackButton mounted at layout.js:39) but
//   keeps About + Privacy + Terms + BGG logo for legal accessibility and trust.
export default function Footer() {
  const { user, isLoading } = useUser();

  if (isLoading) return <div className="h-12" />;

  if (!user) return <PublicFooter />;
  return <AuthFooter />;
}

function PublicFooter() {
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const year = new Date().getFullYear();

  return (
    <>
      <footer className="bg-surface-page border-t border-line">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-content-muted">
            <div className="flex items-center gap-4">
              <a
                href="/about"
                className="hover:text-content-secondary transition-colors"
              >
                About
              </a>
              <a
                href="/Privacy"
                className="hover:text-content-secondary transition-colors"
              >
                Privacy
              </a>
              <a
                href="/terms"
                className="hover:text-content-secondary transition-colors"
              >
                Terms
              </a>
              <button
                onClick={() => setShowFeedbackForm(true)}
                className="hover:text-content-secondary transition-colors"
                aria-label="Report bug or suggest feature"
              >
                Report bug
              </button>
            </div>
            <div className="flex items-center gap-3">
              <BGGLogo />
              <span>© {year} Next Game Night</span>
            </div>
          </div>
        </div>
      </footer>

      {showFeedbackForm && (
        <FeedbackForm onClose={() => setShowFeedbackForm(false)} />
      )}
    </>
  );
}

function AuthFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-surface-page border-t border-line">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-content-muted">
          <div className="flex items-center gap-4">
            <a
              href="/about"
              className="hover:text-content-secondary transition-colors"
            >
              About
            </a>
            <a
              href="/Privacy"
              className="hover:text-content-secondary transition-colors"
            >
              Privacy
            </a>
            <a
              href="/terms"
              className="hover:text-content-secondary transition-colors"
            >
              Terms
            </a>
          </div>
          <div className="flex items-center gap-3">
            <BGGLogo />
            <span>© {year} Next Game Night</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
