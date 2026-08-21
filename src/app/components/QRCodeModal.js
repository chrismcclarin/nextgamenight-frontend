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
        {/* Delta review 2026-08-06 (MED): same 44px real-box idiom as Modal.tsx's
            ModalHeader DialogClose — this headerless modal was the one fleet member
            the D1 fix missed.
            88-33 Task 3 (fork 6, UAT row 333): TWO corrections. (1) `leading-none` was
            missing, so the glyph rode the `text-2xl` line-box and sat visibly LOWER than
            the fleet's — that is the walk's "sits LOWER" sighting, and it is why the
            class is here rather than assumed from the shared idiom. (2) The insets move
            from top-1/right-1 to the SAME edge the fleet header's box lands on
            (`px-3 md:px-6` / `py-2 md:py-3`), so a headerless modal's close is not on a
            different edge from every other modal's. */}
        <button
          onClick={onClose}
          className="absolute top-2 right-3 md:top-3 md:right-6 inline-flex min-h-11 min-w-11 items-center justify-center text-content-muted hover:text-content-primary text-2xl leading-none"
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
