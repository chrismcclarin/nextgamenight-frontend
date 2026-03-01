'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import Link from 'next/link';
import { invitesAPI } from '../../../lib/api';

function InviteAcceptPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { user, isLoading: authLoading } = useUser();

  const [status, setStatus] = useState('loading'); // loading | accepting | accepted | error | not-logged-in
  const [groupId, setGroupId] = useState(null);
  const [groupName, setGroupName] = useState(null);
  const [error, setError] = useState(null);
  const [inviteInfo, setInviteInfo] = useState(null);

  // Handle logged-in user: auto-accept the invite
  useEffect(() => {
    if (authLoading) return;

    if (!token) {
      setStatus('error');
      setError('Invalid invite link');
      return;
    }

    if (!user) {
      setStatus('not-logged-in');
      // Store token in localStorage as backup for post-login redirect
      if (typeof window !== 'undefined') {
        localStorage.setItem('pendingInviteToken', token);
      }
      return;
    }

    // User is logged in -- accept the invite
    async function acceptInvite() {
      setStatus('accepting');

      // Check localStorage for a pending token (backup for post-login redirect)
      let tokenToUse = token;
      if (typeof window !== 'undefined') {
        const storedToken = localStorage.getItem('pendingInviteToken');
        if (storedToken) {
          tokenToUse = storedToken;
          localStorage.removeItem('pendingInviteToken');
        }
      }

      try {
        const result = await invitesAPI.acceptInviteByToken(tokenToUse);
        setStatus('accepted');
        setGroupId(result.group_id || result.groupId || null);
        setGroupName(result.group_name || result.groupName || null);
      } catch (err) {
        setStatus('error');
        const msg = err.message || 'Something went wrong';
        if (msg.includes('not found') || msg.includes('already')) {
          setError('This invite may have already been accepted or expired.');
        } else if (msg.includes('not for you') || msg.includes('different email')) {
          setError('This invite was sent to a different email address.');
        } else {
          setError(msg);
        }
      }
    }

    acceptInvite();
  }, [user, authLoading, token]);

  // Fetch invite info for not-logged-in users (public endpoint)
  useEffect(() => {
    if (status !== 'not-logged-in' || !token) return;

    async function fetchInviteInfo() {
      try {
        const info = await invitesAPI.getInviteInfo(token);
        setInviteInfo(info);
      } catch (err) {
        // Fall back to generic message if fetch fails
        console.error('Failed to fetch invite info:', err.message);
      }
    }

    fetchInviteInfo();
  }, [status, token]);

  // Loading state while Auth0 resolves
  if (authLoading || status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full mx-4 text-center">
          <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-emerald-600 rounded-full animate-spin mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full mx-4">

        {/* Accepting state */}
        {status === 'accepting' && (
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-emerald-600 rounded-full animate-spin mb-4" />
            <p className="text-gray-700 font-medium">Accepting your invite...</p>
          </div>
        )}

        {/* Accepted state */}
        {status === 'accepted' && (
          <div className="text-center">
            {/* Green checkmark */}
            <div className="mx-auto mb-4 w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              You&apos;ve joined {groupName || 'the group'}!
            </h1>
            <p className="text-gray-600 mb-6">
              You can now see events, suggest games, and coordinate with your group.
            </p>
            <div className="flex flex-col gap-3">
              {groupId && (
                <Link
                  href={`/groupHomePage?id=${groupId}`}
                  className="block w-full px-4 py-2.5 text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium text-center transition-colors"
                >
                  Go to Group
                </Link>
              )}
              <Link
                href="/"
                className="block w-full px-4 py-2.5 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium text-center transition-colors"
              >
                Go Home
              </Link>
            </div>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="text-center">
            {/* Red X icon */}
            <div className="mx-auto mb-4 w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Unable to accept invite
            </h1>
            <p className="text-gray-600 mb-6">{error}</p>
            <Link
              href="/"
              className="block w-full px-4 py-2.5 text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium text-center transition-colors"
            >
              Go Home
            </Link>
          </div>
        )}

        {/* Not logged in state */}
        {status === 'not-logged-in' && (
          <div className="text-center">
            {/* Invite icon */}
            <div className="mx-auto mb-4 w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>

            <h1 className="text-xl font-bold text-gray-900 mb-2">
              You&apos;re invited!
            </h1>

            {inviteInfo ? (
              <p className="text-gray-600 mb-6">
                <span className="font-medium text-gray-800">{inviteInfo.inviter_name || 'Someone'}</span> invited you to join{' '}
                <span className="font-medium text-gray-800">{inviteInfo.group_name || 'a group'}</span> on Next Game Night.
                {inviteInfo.member_count && (
                  <span className="block text-sm text-gray-500 mt-1">
                    The group has {inviteInfo.member_count} member{inviteInfo.member_count !== 1 ? 's' : ''}.
                  </span>
                )}
              </p>
            ) : (
              <p className="text-gray-600 mb-6">
                You&apos;ve been invited to a group on Next Game Night.
              </p>
            )}

            <a
              href={`/api/auth/login?returnTo=${encodeURIComponent(`/invite/accept?token=${token}`)}`}
              className="block w-full px-4 py-2.5 text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium text-center transition-colors"
            >
              Sign in to accept
            </a>

            <p className="text-xs text-gray-400 mt-4">
              Don&apos;t have an account? Signing in will create one automatically.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

export default InviteAcceptPage;
