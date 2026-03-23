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
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-sm mx-4 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-2xl"
          aria-label="Close"
        >
          &times;
        </button>

        <h2 className="text-xl font-bold text-gray-900 mb-4 text-center">{title}</h2>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <QRCodeSVG value={url || ''} size={200} level="M" marginSize={2} />
        </div>

        {/* Copy Invite Link Button */}
        <button
          onClick={handleCopyLink}
          className="w-full px-4 py-2.5 text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg font-medium text-center transition-colors mb-3"
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
          className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default QRCodeModal;
