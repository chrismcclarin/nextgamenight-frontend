'use client';

import { useState, useContext } from 'react';
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react';
import { FriendshipContext } from './FriendshipStatusProvider';

/**
 * ClickableMemberName - Wraps a member name with a click-to-open tooltip
 * for sending friend requests.
 *
 * Non-clickable cases (renders as plain span):
 * - self: own name
 * - accepted: already friends
 * - unknown: API failed, graceful degradation
 *
 * @param {string} userId - Auth0 user_id of the member
 * @param {string} username - Display name
 * @param {React.ReactNode} children - Optional custom render (defaults to username span)
 */
export default function ClickableMemberName({ userId, username, children }) {
  const { getStatus, sendRequest } = useContext(FriendshipContext);
  const [isOpen, setIsOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState(false);

  const status = getStatus(userId);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  // Non-clickable cases: render as plain text
  if (status === 'self' || status === 'accepted' || status === 'unknown') {
    return children || <span>{username}</span>;
  }

  const handleSendRequest = async () => {
    setSendError(false);
    try {
      await sendRequest(userId);
      setSent(true);
      setTimeout(() => setIsOpen(false), 1500);
    } catch (err) {
      console.error('Failed to send friend request:', err);
      setSendError(true);
    }
  };

  const renderTooltipContent = () => {
    // Already sent (optimistic UI after clicking Add friend)
    if (sent) {
      return (
        <div className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
          <span>&#10003;</span>
          <span>Request sent</span>
        </div>
      );
    }

    if (sendError) {
      return (
        <div className="text-sm text-red-600">
          Failed to send request
        </div>
      );
    }

    // Pending states
    if (status === 'pending_sent' || status === 'pending_received') {
      return (
        <button
          disabled
          className="text-sm text-gray-400 cursor-not-allowed px-2 py-1 rounded bg-gray-100 border border-gray-200"
        >
          Request pending
        </button>
      );
    }

    // status === 'none' — can add friend
    return (
      <button
        onClick={handleSendRequest}
        className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded transition-colors font-medium"
      >
        Add friend
      </button>
    );
  };

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        className="cursor-pointer hover:underline"
      >
        {children || username}
      </span>
      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2 z-[60]"
          >
            {renderTooltipContent()}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
