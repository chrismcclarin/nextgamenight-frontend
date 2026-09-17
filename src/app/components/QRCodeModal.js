'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Button } from '../../components/ui/Button';
import { logger, errCtx } from '@/lib/logger';

function QRCodeModal({ isOpen, onClose, url, title, onReset = null, showReset = false }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      /* DECISION Phase 88.6-33 (AC-2 WIDENED 2026-09-09, level AMENDED by the D2 ruling
         2026-09-13): `logger.info` — a Sentry BREADCRUMB — chosen OVER `logger.error`, which
         AC-2 originally ruled. A clipboard failure is a common, benign user-environment outcome
         (denied permission, insecure context); an event here would flush the Session Replay
         buffer under `replaysOnErrorSampleRate` and buy replay volume the `no-console` milestone
         gate never asked for. `logger.warn` is NOT a cheaper arm — it is `Sentry.captureMessage`
         (`src/lib/logger.ts:31-32`), also an event.

         THIS RETIRES the clipboard-noise question rather than answering it: there is no
         `captureConsoleIntegration` in `sentry.client.config.js`, so this call is a breadcrumb
         today and stays one. NO new event, NO new replay egress — the egress delta versus today
         is NIL. What the conversion buys is retiring the raw `console.*` for the ROADMAP `:28`
         gate. `FriendInvitePanel.js:353` is the shipped twin of this exact shape.

         `errCtx(err)` and never the raw `Error`: `logger.info(msg, ctx)`'s second parameter is
         `ctx?: Record<string, unknown>` (`src/lib/logger.ts:24`), which `checkJs: false` cannot
         catch at a `.js` call site. `errCtx` is the house helper (its own `DECISION Phase
         88.6-13` marker records that a hand-written `{ name, message }` literal at the call site
         reds `fetchErrorTreatment`'s R1 gate it never touched). Converted IN PLACE: this is a
         catch inside an event handler, not a render body, so no latch is needed. */
      logger.info('Failed to copy link:', errCtx(err));
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
            different edge from every other modal's.

            DECISION Phase 88.6-33 (D48): this `×` STAYS BARE — left byte-unchanged while the
            modal's two other controls migrated to `<Button>` in the same commit. Chosen OVER
            `<Button size="icon" variant="ghost">`, for three independently sufficient reasons:
              1. `.btn`'s UNLAYERED `padding: 0.5rem 1rem` (globals.css:2202) widens this tuned
                 44px box to roughly 56px and shifts the glyph centre OFF the fleet-header edge
                 the 88-33 Task 3 correction above deliberately set. A layered utility cannot
                 win that back.
              2. A variant-less `<Button>` inherits `defaultVariants: { variant: 'primary' }`
                 (Button.tsx:255) and would paint the purple fill UI-SPEC §3.2 forbids on a bare
                 control; UI-SPEC §3.2's bare-`<button>` row names THIS site as the
                 left-bare arm.
              3. `Modal.tsx`'s fleet-header `DialogClose` is bare and is migrated by NO plan in
                 this phase. Migrating this one alone would CREATE a fleet inconsistency rather
                 than close one.
            The glyph itself is ICON sizing (D-02) — it leaves the type scale and is never
            converged.

            RESIDUAL THIS COMMIT CREATES, recorded rather than fixed: with the modal's four other
            controls now on the house focus ring, this `×` is the only control here still on the
            user agent's default outline — its className carries no focus utility. That is a
            CONSISTENCY residual, NOT an AA violation (WCAG 2.4.7 is satisfied by the UA outline),
            and it is a DIVERGENCE from the fleet close rather than something the fleet shares:
            `Modal.tsx`'s `DialogClose` DOES carry `focus-visible:ring-2 focus-visible:ring-ring`.
            Same kind as the `BrowseMoreModal` stepper residual plan 05 routed under AC-10.
            Reaching for a focus utility here as a "small exception" would edit the very element
            D48 resolves to leave byte-unchanged. Changing any of this is a decision, not a
            cleanup. */}
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

        {/* Copy Invite Link Button.
            88.6-33 (§3.2/§3.3): `<Button variant="primary" size="default">`. `py-2.5` was DEAD
            under unlayered `.btn`'s `padding` (globals.css:2202) and is deleted rather than
            moved; `w-full`, `text-center` and `mb-3` all SURVIVE — `.btn` declares no width, no
            `text-align` and no margin, so none of the three was ever dead. */}
        <Button
          variant="primary"
          onClick={handleCopyLink}
          className="w-full text-center mb-3"
        >
          {copied ? 'Copied!' : 'Copy Invite Link'}
        </Button>

        {/* Reset Token Button (owner/admin only).
            DECISION Phase 88.6-33 (§4.5 EMPHASIS): `font-normal` over `font-bold` on this label.
            This control is not a `.btn` and never was, so the weight was ALIVE — deleting it is a
            real change, not a dead-class cleanup. 400 is correct because the distinction here is
            already carried by COLOUR: it is the only red control in a modal whose two other
            actions are a filled primary and a filled secondary. 700 was rejected because it would
            give a destructive-adjacent tertiary action more visual weight than the primary CTA
            above it. The stated-400 spelling (rather than simply dropping the utility) follows the
            shipped `createEvent.js:1290` idiom this plan converges its other weight sites on. */}
        {showReset && onReset && (
          <button
            onClick={onReset}
            className="w-full px-4 py-2 text-red-600 hover:text-red-700 text-sm font-normal text-center transition-colors mb-3"
          >
            Reset Token
          </button>
        )}

        {/* Close Button.
            88.6-33 (§3.2/§3.3): `<Button variant="secondary" size="default">`. `w-full` survives
            (`.btn` declares no width); nothing else rode this className, so nothing was deleted. */}
        <Button
          variant="secondary"
          onClick={onClose}
          className="w-full"
        >
          Close
        </Button>
      </Modal.Body>
    </Modal>
  );
}

export default QRCodeModal;
