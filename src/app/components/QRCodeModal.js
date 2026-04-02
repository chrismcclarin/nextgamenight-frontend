'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

function QRCodeModal({ isOpen, onClose, url, title, onReset, showReset = false }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-sm w-full mx-4 p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-content-muted hover:text-content-primary text-2xl"
          aria-label="Close"
        >
          &times;
        </button>

        <h2 className="text-xl font-bold text-content-primary mb-4 text-center">{title}</h2>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <QRCodeSVG value={url || ''} size={200} level="M" marginSize={2} />
        </div>

        {/* Copy Invite Link Button */}
        <button
          onClick={handleCopyLink}
          className="w-full btn btn-primary py-2.5 text-center mb-3"
        >
          {copied ? 'Copied!' : 'Copy Invite Link'}
        </button>

        {/* Reset Token Button (owner/admin only) */}
        {showReset && onReset && (
          <button
            onClick={onReset}
            className="w-full px-4 py-2 text-red-600 hover:text-red-700 text-sm font-medium text-center transition-colors mb-3"
          >
            Reset Token
          </button>
        )}

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full btn btn-secondary"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default QRCodeModal;
