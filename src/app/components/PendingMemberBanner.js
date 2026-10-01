'use client';
import { useState, useEffect } from 'react';
import { Button } from '../../components/ui/Button';

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
        <div className="bg-surface-accent-subtle border border-line-accent rounded-card p-4 mb-4 flex items-center justify-between">
            {/* DECISION Phase 88.6-34: this body STAYS at Label 14 — chosen OVER UI-SPEC §4.3's
                "`<p>` running prose -> Body 16" row and over this plan's own task text, both of
                which say 16. The record says 14 more specifically and THREE times: plan 88.6-17
                kept the SMS-disabled banner at 14, plan 88.6-19 faced this exact question and kept
                14, and plan 88.6-26 kept `TimezoneNudgeBanner` at 14 with `PendingMemberBanner.js`
                cited BY NAME as the sibling it matches. `Banner.tsx`'s own cva base is `text-sm`.
                Classify: satisfying §4.3's row here is a BOOKKEEPING win bought with a CONSEQUENCE
                loss — one banner off its own family's rung, on the phone-primary surface, where
                88.6-26 MEASURED the equivalent move at +40px of banner height. The open question
                (should the whole Banner family move to 16?) is ROUTED, not answered for one member.
                Moving this one to 16 alone is a decision, not a cleanup. */}
            <p className="text-content-secondary text-sm">
                Welcome! You&apos;re a pending member &mdash; an admin will approve you shortly. Feel free to look around in the meantime.
            </p>
            {/* DECISION Phase 88.6-34 (D48 / UI-SPEC §3.2): the dismiss control is a
                `<Button variant="ghost" size="icon">` with the mark in a CHILD — the shipped
                `BottomSheet.tsx:235-236` glyph idiom — chosen OVER leaving it a bare `<button>`
                and OVER the alternative bare idiom (`inline-flex items-center justify-center
                min-h-11 min-w-11`, the `QRCodeModal.js:40` shape), which would have bought the
                same 44px floor with no look change at all. The default is implemented; the bare
                alternative is named in `88.6-34-SUMMARY.md` as a residual owner call.

                WHY IT IS A REAL WIN, not bookkeeping: the tap target today is the BARE GLYPH,
                under the V-1 floor, on the phone-primary surface.

                THE LOOK IS ACCEPTED, DELIBERATELY, and it is visible: migrating hands a banner
                dismiss `.btn`'s lozenge padding, its hover wash and elevation, and 14px/600 type it
                does not have today. That accept is already disclosed — UI-SPEC §1.2's **V-15**
                names THIS SITE by file and line as one of its two migrated bare glyph buttons. No
                new V-number is minted; minting one would put a second row in a CLOSED list for a
                delta already rowed.

                THE CLASS DISPOSITION IS THREE-PART AND EXHAUSTIVE:
                  - `text-lg leading-none` MOVES to the glyph child. A `text-*` size on the button
                    element would be DEAD under `.btn`'s unlayered `font-size`.
                  - the per-site focus string is DELETED — it was byte-identical to `Button.tsx`'s
                    own, so keeping it duplicated the ring rather than protecting it.
                  - `ml-4 shrink-0` are KEPT, and they are LIVE LAYOUT, not decoration: the wrapper
                    is `flex items-center justify-between`, so `ml-4` is the gap from the prose and
                    `shrink-0` is what stops the glyph collapsing when the `<p>` wraps at 375px.
                    Dropping either is a phone-layout regression, not a cleanup.

                `variant` is written EXPLICITLY — omitting it defaults to `primary`, which paints a
                filled button for a bare glyph and is what §3.2 rejects. `aria-label` is preserved;
                no name is added, because none was missing. */}
            <Button
                variant="ghost"
                size="icon"
                onClick={handleDismiss}
                className="ml-4 shrink-0"
                aria-label="Dismiss banner"
            >
                <span aria-hidden="true" className="text-lg leading-none">&times;</span>
            </Button>
        </div>
    );
}
