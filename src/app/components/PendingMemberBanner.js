'use client';
import { useState, useEffect } from 'react';

export default function PendingMemberBanner({ groupId }) {
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        const key = 'pending_banner_dismissed_' + groupId;
        if (sessionStorage.getItem(key) === 'true') {
            setDismissed(true);
        }
    }, [groupId]);

    if (dismissed) return null;

    const handleDismiss = () => {
        sessionStorage.setItem('pending_banner_dismissed_' + groupId, 'true');
        setDismissed(true);
    };

    return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 flex items-center justify-between">
            <p className="text-blue-800 text-sm">
                Welcome! You&apos;re a pending member &mdash; an admin will approve you shortly. Feel free to look around in the meantime.
            </p>
            <button
                onClick={handleDismiss}
                className="text-blue-400 hover:text-blue-600 ml-4 flex-shrink-0 text-lg leading-none"
                aria-label="Dismiss banner"
            >
                &times;
            </button>
        </div>
    );
}
