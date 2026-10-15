'use client';
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { DialogTitle } from '../../components/ui/dialog';
import { Modal } from './Modal';
import { Button } from '../../components/ui/Button';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { logger, errCtx } from '@/lib/logger';

// Copy row G3 (88.6.1-COPY-TABLE.html, ratified 2026-10-04; D-30 placement rule: a hoisted
// constant at the site). Byte-equal to the table; it holds no apostrophe and no ellipsis.
const LINK_COPIED_ANNOUNCEMENT = 'Invite link copied to the clipboard.';
// How long the visible label reads Copied! after a successful copy.
const COPIED_LABEL_MS = 2000;

function QRCodeModal({ isOpen, onClose, url, title }) {
  const [copied, setCopied] = useState(false);
  // Bumped once per successful copy; keys the announcement text so a repeat copy re-announces.
  const [copySeq, setCopySeq] = useState(0);

  // DECISION Phase 88.6.1-12 (Req 11, copy-confirmation timer): the label timer's handle is
  // HELD IN A REF and cleared before every re-arm, when the dialog closes and on unmount (the
  // FeedbackButton idiom), chosen OVER unmount-only cleanup. Both hosts (EventDayModal and the
  // game detail page) keep this dialog mounted while it is closed, so closing is the common
  // exit: an unmount-only clear would still show a stale Copied! label on a reopen and let the
  // old timer cut a fresh confirmation short.
  // A clipboard write that settles AFTER the dialog closed sets NOTHING (no label, no
  // announcement, no timer): a copy's outcome belongs to the open session in which Copy was
  // pressed. The handler captures the open generation before the await, and the close effect
  // bumps it. REJECTED: letting the late write set the label (the link WAS copied, but a reopen
  // inside 2 s would then show a stale Copied! with the announcement already in the region's
  // first commit, and the late timer would flip the label while the user watches, which breaks
  // the reopen-is-fresh rule and SPEC Edge R11); REJECTED: mirroring the open flag into a ref
  // instead of a generation counter (a write that spans a close AND a reopen would read the ref
  // as open again and land in the new session). Changing any of this is a decision, not a
  // cleanup.
  const copiedTimerRef = useRef(null);
  const openGenerationRef = useRef(0);

  useEffect(() => {
    if (isOpen) return;
    openGenerationRef.current += 1;
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = null;
    setCopied(false);
  }, [isOpen]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const handleCopyLink = async () => {
    if (!url) return;
    const generation = openGenerationRef.current;
    try {
      await navigator.clipboard.writeText(url);
      if (openGenerationRef.current !== generation) return;
      setCopied(true);
      setCopySeq((n) => n + 1);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, COPIED_LABEL_MS);
    } catch (err) {
      /* DECISION Phase 88.6-33 (AC-2 WIDENED 2026-09-09, level AMENDED by the D2 ruling
         2026-09-13): `logger.info` — a Sentry BREADCRUMB — chosen OVER `logger.error`, which
         AC-2 originally ruled. A clipboard failure is a common, benign user-environment outcome
         (denied permission, insecure context); an event here would flush the Session Replay
         buffer under `replaysOnErrorSampleRate` and buy replay volume the `no-console` milestone
         gate never asked for. `logger.warn` is NOT a cheaper arm — it is `Sentry.captureMessage`
         (`src/lib/logger.ts:50`, `Sentry.captureMessage`), also an event.

         THIS RETIRES the clipboard-noise question rather than answering it: there is no
         `captureConsoleIntegration` in `sentry.client.config.js`, so this call is a breadcrumb
         today and stays one. NO new event, NO new replay egress — the egress delta versus today
         is NIL. What the conversion buys is retiring the raw `console.*` for the ROADMAP `:28`
         gate. `FriendInvitePanel.js:376` (`'Failed to copy link:'`) is the shipped twin of
         this exact shape.

         `errCtx(err)` and never the raw `Error`: `logger.info(msg, ctx)`'s second parameter is
         `ctx?: Record<string, unknown>` (`src/lib/logger.ts:31`, `info(msg: string`), which
         `checkJs: false` cannot catch at a `.js` call site. `errCtx` is the house helper (its
         own `DECISION Phase 88.6-13` marker records that a hand-written `{ name, message }`
         literal at the call site reds `fetchErrorTreatment`'s R1 gate it never touched).
         Converted IN PLACE: this is a catch inside an event handler, not a render body, so no
         latch is needed. */
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
              1. `.btn`'s UNLAYERED `padding: 0.5rem 1rem` (`src/app/globals.css:2298`,
                 `padding: 0.5rem 1rem;` inside the `.btn {` rule) widens this tuned
                 44px box to roughly 56px and shifts the glyph centre OFF the fleet-header edge
                 the 88-33 Task 3 correction above deliberately set. A layered utility cannot
                 win that back.
              2. A variant-less `<Button>` inherits `defaultVariants: { variant: 'primary' }`
                 (Button.tsx:255) and would paint the purple fill UI-SPEC §3.2 forbids on a bare
                 control; UI-SPEC §3.2's bare-`<button>` row names THIS site as the
                 left-bare arm. AMENDED Phase 88.6.1-12 (W037): this reason bears only on a
                 variant-less primitive, and the alternative rejected above names the ghost
                 variant, so it does not decide the matter on its own; reasons 1 and 3 decide.
              3. `Modal.tsx`'s fleet-header `DialogClose` is bare and is migrated by NO plan in
                 this phase. Migrating this one alone would CREATE a fleet inconsistency rather
                 than close one.
            The glyph itself is ICON sizing (D-02) — it leaves the type scale and is never
            converged.

            RESIDUAL THIS COMMIT CREATES, recorded rather than fixed: with the modal's two other
            controls (Copy Invite Link and the footer Close) on the house focus ring, this `×` is
            the only control here still on the user agent's default outline — its className
            carries no focus utility. That is a CONSISTENCY residual, NOT an AA violation (WCAG
            2.4.7 is satisfied by the UA outline), and it is a DIVERGENCE from the fleet close
            rather than something the fleet shares: `Modal.tsx`'s `DialogClose` DOES carry
            `focus-visible:ring-2 focus-visible:ring-ring`.
            Same kind as the `BrowseMoreModal` stepper residual plan 05 routed under AC-10.
            Reaching for a focus utility here as a "small exception" would edit the very element
            D48 resolves to leave byte-unchanged.

            AMENDED Phase 88.6.1-12 (W037 / IN-304, D-27): as first written, this paragraph
            over-counted the modal's other controls and called the × the only one off the house
            ring, while at that commit the conditional destructive tertiary text control was ALSO
            on the UA outline. 88.6.1-12 deleted that control under D-27 (no host enabled it and
            no caller supplied its handler, so it could never render), which makes the corrected
            sentence above true. QRCodeModal.test.tsx now pins the inventory: three controls,
            exactly one of them without the house ring. The residual's OWNER is Phase 88.9, in
            .planning/deferred/phase-88.9.md under the heading
            "QRCodeModal corner close is the one control on the UA default focus outline",
            routed there because adopting a ring changes the visible focus indicator on a 44px
            box anchored in the dialog corner, which is a look call. Reasons 1-3 above still
            decide that the element stays a bare control. Changing any of this is a decision,
            not a cleanup. */}
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
            under unlayered `.btn`'s `padding` (`src/app/globals.css:2298`,
            `padding: 0.5rem 1rem;`) and is deleted rather than
            moved; `w-full`, `text-center` and `mb-3` all SURVIVE — `.btn` declares no width, no
            `text-align` and no margin, so none of the three was ever dead. */}
        <Button
          variant="primary"
          onClick={handleCopyLink}
          className="w-full text-center mb-3"
        >
          {copied ? 'Copied!' : 'Copy Invite Link'}
        </Button>

        {/* DECISION Phase 88.6.1-12 (copy row G3, D-30; Req 8): the copy outcome on this
            game-night share QR is ANNOUNCED, and the visible Copied! swap on the copy button is
            KEPT, following the FriendInvitePanel twin (DECISION Phase 88.6-22): a label change on
            the focused element is not announced. The polite status region is sr-only for its
            whole life, chosen OVER D-22's sr-only-while-empty prop, which makes the message
            VISIBLE once set and would print the same fact under a button that already says it
            (88.6-22's rejected arm). The text sits in a span keyed on a per-copy sequence, so a
            repeat copy is a new text node and re-announces (SPEC R8 idempotency, the
            EventScheduler idiom), chosen OVER clearing the state at the start of the handler
            (the NextGameNightCard idiom), which would flash the focused button's visible label
            back to Copy Invite Link during the clipboard write. It is announced only after the
            write resolves and only when there is a link, so it never states a copy that did not
            happen. Changing any of this is a decision, not a cleanup. */}
        <StatusRegion className="sr-only">
          <span key={copySeq}>{copied ? LINK_COPIED_ANNOUNCEMENT : ''}</span>
        </StatusRegion>

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
