import type * as React from 'react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account deleted — Next Game Night',
};

// Public, sessionless terminal page shown after account deletion (SPEC Req 7, D-16).
// The account no longer exists, so this must render WITHOUT a session — no useUser,
// no client auth guard, no authenticated fetch. Mirrors privacy/page.js: a plain
// server component using the app's prose container + content tokens.
//
// Phase 88.8 (SPEC R9 / D-22): the page gained a `reason` variant, read from
// server-side `searchParams`. Two arrivals now land here and they are NOT the
// same person: the DELETE flow (DangerZoneDeleteAccount -> logout?returnTo=
// /goodbye) where the user just pressed delete, and the OAuth tombstone
// (plan 06's backend -> logout?returnTo=/goodbye?reason=account_deleted) where
// the user just tried to SIGN IN to an account that is already gone. The
// default copy's "we're sorry to see you go" framing is wrong for the second.
// It stays a SERVER component: `searchParams` is a plain prop in Next 14, so
// this needs no 'use client', no hook and no fetch — the sessionless contract
// above is intact.
// ACCEPTED RENDERING-MODE CHANGE (named, not silent): reading `searchParams`
// opts this route into per-request DYNAMIC rendering; it was a static prerender
// before. Fine at this page's traffic — it is a terminal page reached at most
// once per account, it fetches nothing, and it renders no session data.

/* DECISION Phase 88.8 D-22 / T-88.8-56: the copy is selected by a STRICT
   equality test against the one fixed constant below, chosen OVER interpolating
   the parameter into what the user reads. This page is public and `reason` is attacker-
   controllable, so an interpolated value would let anyone who can get a person
   to open a crafted /goodbye?reason=... URL put arbitrary text on a page that
   looks like ours — unbounded attacker-authored COPY. React escapes it, so it
   is not injection; that is not the part that matters.
   This preserves DECISION Phase 88-25 (userProfile/page.js:913-921), which made
   exactly this call for `?google_calendar=error&message=…` on the other
   query-parameter-driven message in this app. Do not "improve" this by
   rendering the reason — an unknown reason falls back to the default copy on
   purpose. */
const ACCOUNT_DELETED = 'account_deleted';

interface GoodbyePageProps {
  // Next 14 passes searchParams synchronously; a repeated key arrives as an
  // array, which simply fails the strict compare below and gets the default.
  searchParams?: { reason?: string | string[] };
}

export default function Goodbye({
  searchParams,
}: GoodbyePageProps): React.JSX.Element {
  const signedOutFromDeletedAccount = searchParams?.reason === ACCOUNT_DELETED;

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      {signedOutFromDeletedAccount ? (
        <>
          <h1 className="text-4xl font-bold text-content-primary mb-2">
            This account has been deleted
          </h1>
          <p className="text-sm text-content-muted mb-10">
            You can start fresh whenever you like.
          </p>

          <div className="prose prose-gray max-w-none space-y-8 text-content-secondary leading-relaxed">
            <section>
              <p>
                The account you just tried to sign in with was permanently deleted, along with
                its groups, events, game logs, reviews, and availability. Deletion is final, so
                there is nothing left to sign back in to.
              </p>
              <p className="mt-3">
                If you want to use Next Game Night again, you can sign up again from scratch —
                including with the same email address. You&apos;ll start with a brand new, empty
                account.
              </p>
            </section>

            <section>
              <a
                href="/"
                className="text-content-accent underline hover:text-content-accent-hover"
              >
                Return to Next Game Night
              </a>
            </section>
          </div>
        </>
      ) : (
        <>
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
                className="text-content-accent underline hover:text-content-accent-hover"
              >
                Return to Next Game Night
              </a>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
