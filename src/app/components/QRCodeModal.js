'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';

function QRCodeModal({ isOpen, onClose, url, title, onReset = null, showReset = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  // size="sm" maps to the legacy `max-w-sm` width. This modal is freeform (no
  // header/footer chrome): the title + QR + actions live in <Modal.Body>. The
  // centered title is rendered as the DialogTitle so Radix auto-wires
  // aria-labelledby (the modal's accessible name) while keeping the original
  // centered visual. Esc / focus-trap / aria-modal come from <Modal>.
  return (
    <Modal open={isOpen} onClose={onClose} size="sm">
      <Modal.Body className="relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-content-muted hover:text-content-primary text-2xl"
          aria-label="Close"
        >
          &times;
        </button>

        <DialogTitle className="text-xl font-bold text-content-primary mb-4 text-center">
          {title}
        </DialogTitle>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <QRCodeSVG
            value={url || ''}
            size={200}
            level="M"
            marginSize={2}
            title="QR code for the invite link"
          />
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
      </Modal.Body>
    </Modal>
  );
}

export default QRCodeModal;
