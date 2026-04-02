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
        <div className="bg-accent/10 border border-accent/30 rounded-card p-4 mb-4 flex items-center justify-between">
            <p className="text-content-secondary text-sm">
                Welcome! You&apos;re a pending member &mdash; an admin will approve you shortly. Feel free to look around in the meantime.
            </p>
            <button
                onClick={handleDismiss}
                className="text-content-muted hover:text-content-secondary ml-4 flex-shrink-0 text-lg leading-none"
                aria-label="Dismiss banner"
            >
                &times;
            </button>
        </div>
    );
}
