import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account deleted — Next Game Night',
};

// Public, sessionless terminal page shown after account deletion (SPEC Req 7, D-16).
// The account no longer exists, so this must render WITHOUT a session — no useUser,
// no client auth guard, no authenticated fetch. Mirrors privacy/page.js: a plain
// server component using the app's prose container + content tokens.
export default function Goodbye() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-content-primary mb-2">Your account has been deleted</h1>
      <p className="text-sm text-content-muted mb-10">We&apos;re sorry to see you go.</p>

      <div className="prose prose-gray max-w-none space-y-8 text-content-secondary leading-relaxed">
        <section>
          <p>
            Your account and the data associated with it — your groups, events, game logs,
            reviews, and availability — have been permanently removed. This action is final and
            cannot be undone.
          </p>
          <p className="mt-3">
            If any group cleanup or third-party revocation was still in progress, it will finish
            on its own shortly. You don&apos;t need to do anything.
          </p>
          <p className="mt-3">
            Thanks for spending some game nights with us. If you ever want to come back, you&apos;re
            always welcome to start fresh.
          </p>
        </section>

        <section>
          <a
            href="/"
            className="text-accent underline hover:text-accent-hover"
          >
            Return to Next Game Night
          </a>
        </section>
      </div>
    </div>
  );
}
