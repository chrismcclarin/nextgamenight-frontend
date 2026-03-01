'use client';
import { useState, useEffect, useRef } from 'react';
import { invitesAPI } from '../../lib/api';

function NotificationBell({ user }) {
  const [invites, setInvites] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const dropdownRef = useRef(null);

  // Fetch pending invites on mount
  useEffect(() => {
    if (!user?.sub) return;

    async function fetchInvites() {
      try {
        const data = await invitesAPI.getPendingInvites();
        setInvites(Array.isArray(data) ? data : data?.invites || []);
      } catch (err) {
        // If invites API isn't available yet, just set empty
        console.error('Failed to fetch invites:', err.message);
        setInvites([]);
      } finally {
        setLoading(false);
      }
    }

    fetchInvites();
  }, [user?.sub]);

  // Click-outside detection to close dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear confirmation after 3 seconds
  useEffect(() => {
    if (!confirmation) return;
    const timer = setTimeout(() => setConfirmation(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmation]);

  async function handleAccept(invite) {
    setActionLoading(invite.id);
    try {
      await invitesAPI.acceptInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      const groupName = invite.Group?.name || invite.group_name || 'the group';
      setConfirmation(`Joined ${groupName}!`);
    } catch (err) {
      console.error('Failed to accept invite:', err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDecline(invite) {
    setActionLoading(invite.id);
    try {
      await invitesAPI.declineInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      console.error('Failed to decline invite:', err.message);
    } finally {
      setActionLoading(null);
    }
  }

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell icon button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative text-white hover:text-amber-400 transition-colors p-1"
        aria-label="Notifications"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>

        {/* Red badge with count */}
        {invites.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
            {invites.length > 9 ? '9+' : invites.length}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">Notifications</h3>
          </div>

          {/* Confirmation banner */}
          {confirmation && (
            <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100">
              <p className="text-sm text-emerald-700 font-medium">{confirmation}</p>
            </div>
          )}

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center">
                <div className="inline-block w-5 h-5 border-2 border-gray-300 border-t-emerald-600 rounded-full animate-spin" />
              </div>
            ) : invites.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-gray-500">No pending invites</p>
              </div>
            ) : (
              <ul>
                {invites.map((invite) => {
                  const groupName = invite.Group?.name || invite.group_name || 'Unknown Group';
                  const inviterName = invite.Inviter?.username || invite.inviter_name || 'Someone';
                  const memberCount = invite.Group?.memberCount || invite.member_count || null;
                  const isLoading = actionLoading === invite.id;

                  return (
                    <li
                      key={invite.id}
                      className="px-4 py-3 border-b border-gray-50 last:border-b-0"
                    >
                      <p className="text-sm font-semibold text-gray-900">{groupName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {inviterName} invited you
                      </p>
                      {memberCount && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {memberCount} member{memberCount !== 1 ? 's' : ''}
                        </p>
                      )}

                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleAccept(invite)}
                          disabled={isLoading}
                          className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isLoading ? (
                            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            'Accept'
                          )}
                        </button>
                        <button
                          onClick={() => handleDecline(invite)}
                          disabled={isLoading}
                          className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
