// Phase 88.6.1 copy gate (AC-33; D-30, D-32 R1-R8, D-47, D-51; plan 88.6.1-64).
//
// What it guards:
//  - every string the owner ratified for this phase (the copy table D-30, D-32's eight, D-47's
//    sixteen, the 2026-10-13..15 review rulings D-59 / D-64, and the "Not changing" strings) is
//    pinned at the file that DEFINES it, byte-equal after ONE normalisation: the table's U+2019
//    is written here as a straight apostrophe (D-32 R8). Ellipses are NOT normalised (CP-4a):
//    A5 and E8 use U+2026, every other row three ASCII dots;
//  - no non-comment source text (string, template chunk or JSX text) holds U+2019 (R8);
//  - every retired literal is gone from its scope;
//  - RF1 is defined in exactly one file, and every consumer plan's test or spec types it once
//    with the straight apostrophe (D-51, plan 70 contract C7); no test or spec types it curly.
//
// Why the rows are embedded rather than read from 88.6.1-COPY-TABLE.html: CI checks out only
// this repo, so the parent planning repo's HTML cannot be read here. The transcription was
// machine-diffed against that HTML's DATA array when this file was written (plan 64 SUMMARY).
//
// Adding a ratified string means adding a row here, in the commit that lands it (D-31).
// A row's site is where the constant or template is DEFINED; its importers go in IMPORTERS.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const E2E = path.resolve(SRC, '..', 'e2e');
const SELF = path.resolve(__filename);
const CURLY = '\u2019';

type RowKind = 'chunk' | 'fragments' | 'concat';
interface RatifiedRow {
  id: string;
  text: string;
  site: string;
  kind: RowKind;
  // kind 'fragments': the template's static parts, in order, as consecutive string chunks
  // (nested interpolation chunks may sit between them, at most MAX_FRAGMENT_GAP).
  fragments?: string[];
  // kind 'concat': a sentence built with `+` — each part is a string chunk of the site, and
  // each code snippet appears in the comment-stripped, whitespace-collapsed source.
  parts?: string[];
  code?: string[];
}

// DECISION Phase 88.6.1-64 AC-33: a fourth kind 'concat' (A2, A3) over the plan's 'jsxText' —
// at HEAD those two sentences are joined with `+` from shared word constants, so no single
// chunk or template holds them; and no ratified row ships as bare JSX text, so 'jsxText' had
// no row to serve. Changing either is a decision, not a cleanup.
const RATIFIED_ROWS: RatifiedRow[] = [
  // Home (D-30)
  { id: 'H1', text: 'Customize {group}', site: 'app/components/grouplist.js', kind: 'fragments', fragments: ['Customize ', ''] },
  { id: 'H2', text: 'Invite member to {group}', site: 'app/components/grouplist.js', kind: 'fragments', fragments: ['Invite member to ', ''] },
  { id: 'H3', text: 'Getting your groups...', site: 'app/page.js', kind: 'chunk' },
  { id: 'H4', text: "We couldn't load suggestions.", site: 'app/components/QuickSuggestions.js', kind: 'chunk' },
  { id: 'H5', text: 'Main', site: 'app/Header.js', kind: 'chunk' },
  // Notifications (D-30; N3-N6 passed as `fallback`, D-33 row 22)
  { id: 'N1', text: 'Loading notifications', site: 'app/components/NotificationBell.js', kind: 'chunk' },
  { id: 'N2', text: 'Accepting...', site: 'app/components/NotificationBell.js', kind: 'chunk' },
  { id: 'N3', text: "We couldn't accept that invite. Please try again.", site: 'app/components/NotificationBell.js', kind: 'chunk' },
  { id: 'N4', text: "We couldn't decline that invite. Please try again.", site: 'app/components/NotificationBell.js', kind: 'chunk' },
  { id: 'N5', text: "We couldn't accept that friend request. Please try again.", site: 'app/components/NotificationBell.js', kind: 'chunk' },
  { id: 'N6', text: "We couldn't decline that friend request. Please try again.", site: 'app/components/NotificationBell.js', kind: 'chunk' },
  // Tutorial, phone arms (D-16 kept; T1 struck, see NO_LITERAL)
  { id: 'T2', text: "Tap a time, or press and hold then drag across the times you're available — takes 30 seconds.", site: 'app/components/tutorial/TutorialOverlay.js', kind: 'chunk' },
  { id: 'T3', text: 'Press and hold, then drag across the peak to schedule.', site: 'app/components/tutorial/TutorialOverlay.js', kind: 'chunk' },
  { id: 'T4', text: 'Press and hold, then drag to set the time window — same gesture as availability.', site: 'app/components/tutorial/TutorialOverlay.js', kind: 'chunk' },
  // Availability check-in
  { id: 'A1', text: 'Tap a time to select it. Press and hold, then drag, to select several.', site: 'app/components/AvailabilityGrid.js', kind: 'chunk' },
  { id: 'A2', text: '{day and time}, preferred / , if need be / , not selected', site: 'app/components/AvailabilityGrid.js', kind: 'concat', parts: ['preferred', 'if need be', 'not selected', ', '], code: ["return prefix + ', ' + word;"] },
  { id: 'A3', text: '{n} preferred, {m} if need be slots selected', site: 'app/components/AvailabilityGrid.js', kind: 'concat', parts: ['preferred', 'if need be', 'slots selected'], code: ["preferredCount + ' ' + PREFERENCE_WORD_PREFERRED + ', ' + ifNeedBeCount + ' ' + PREFERENCE_WORD_IF_NEED_BE + ' ' + SELECTION_SUMMARY_TAIL"] },
  { id: 'A4', text: 'All times cleared.', site: 'app/components/AvailabilityGrid.js', kind: 'chunk' },
  { id: 'A5', text: 'Loading your availability…', site: 'app/components/AvailabilityForm.js', kind: 'chunk' },
  // Create Event
  { id: 'C1', text: '{day} at {time}, {n} of {total} available', site: 'app/components/heatmap/slotCellName.ts', kind: 'fragments', fragments: [', ', ' of ', ' available'] },
  { id: 'C2', text: '(required)', site: 'app/components/createEvent.js', kind: 'chunk' },
  // Event page
  { id: 'E1', text: "You don't have access to this event", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E2', text: "You may be signed in with a different account, or you haven't been invited yet.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E3', text: "We couldn't load this event", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E4', text: 'Loading game night...', site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E4b', text: 'Loading game night...', site: 'app/components/createEvent.js', kind: 'chunk' },
  { id: 'E5', text: 'To Date must be on or after From Date.', site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E6', text: 'Loading QR code...', site: 'app/components/shareGameQrCopy.ts', kind: 'chunk' },
  { id: 'E8', text: 'Updating suggestions…', site: 'app/components/BrowseMoreModal.js', kind: 'chunk' },
  { id: 'E9', text: "You haven't added any games to your collection yet.", site: 'app/components/BringGamePicker.js', kind: 'chunk' },
  { id: 'E10', text: "We couldn't load your games. Close this and try again.", site: 'app/components/BringGamePicker.js', kind: 'chunk' },
  { id: 'E11', text: "You've reached the 500-character limit.", site: 'app/components/RsvpSection.js', kind: 'chunk' },
  { id: 'E12', text: "We couldn't save your vote. Please try again.", site: 'app/components/BallotSection.js', kind: 'chunk' },
  { id: 'E13', text: "We couldn't set the winner. Please try again.", site: 'app/components/BallotSection.js', kind: 'chunk' },
  { id: 'E14', text: '{game name}, saving', site: 'app/components/BallotSection.js', kind: 'fragments', fragments: ['', ', saving'] },
  // Group page and its dialogs
  { id: 'G1', text: 'Reset invite link', site: 'app/components/ManageMembers.js', kind: 'chunk' },
  { id: 'G2', text: "We couldn't send that invite. Please try again.", site: 'app/components/FriendInvitePanel.js', kind: 'chunk' },
  { id: 'G3', text: 'Invite link copied to the clipboard.', site: 'app/components/QRCodeModal.js', kind: 'chunk' },
  { id: 'G4', text: 'Loading check-ins...', site: 'app/components/PromptScheduleSection.js', kind: 'chunk' },
  { id: 'G5', text: "Getting your group's plans...", site: 'app/groupPlanning/page.js', kind: 'chunk' },
  { id: 'G6', text: 'Some personal controls are unavailable.', site: 'components/ui/FetchErrorBanner.tsx', kind: 'chunk' },
  // Profile (P2 without a period, D-32 R7 — R7 is this row)
  { id: 'P1', text: 'Verifying...', site: 'app/userProfile/page.js', kind: 'chunk' },
  { id: 'P2', text: 'We sent a code to {address}', site: 'app/components/EmailAddressSection.tsx', kind: 'fragments', fragments: ['We sent a code to ', ''] },
  // Feedback and Report Bug
  { id: 'F1', text: 'Screenshot attached: {file name}', site: 'app/components/FeedbackForm.js', kind: 'fragments', fragments: ['Screenshot attached: ', ''] },
  { id: 'F2', text: "We couldn't send your feedback. Please try again.", site: 'app/components/FeedbackForm.js', kind: 'chunk' },
  // Invite and restore links
  { id: 'L1a', text: 'Checking your invitation...', site: 'app/invite/accept/page.js', kind: 'chunk' },
  { id: 'L1b', text: 'Loading your group invite...', site: 'app/invite/group/[token]/page.js', kind: 'chunk' },
  { id: 'L1c', text: 'Loading your game night invite...', site: 'app/invite/game/[token]/page.js', kind: 'chunk' },
  { id: 'L2', text: 'Checking your restore link...', site: 'app/restore/group/[token]/page.tsx', kind: 'chunk' },
  // Anywhere in the app
  { id: 'X1', text: 'Your session may have expired. Sign in again to continue.', site: 'components/ui/useFetchErrorState.ts', kind: 'chunk' },
  { id: 'X3', text: "We couldn't send that request.", site: 'app/components/ClickableMemberName.js', kind: 'chunk' },
  // D-32 (R6 shares E9's row; R7 is P2's row; R8 is the U+2019 test below)
  { id: 'R1', text: "We couldn't start that check-in. Please try again.", site: 'app/components/StartPollModal.js', kind: 'chunk' },
  { id: 'R2', text: "We couldn't send those invites. Please try again.", site: 'app/components/FriendInvitePanel.js', kind: 'chunk' },
  { id: 'R3', text: "We couldn't confirm your RSVP — the connection timed out. Sign in and open the event to check your answer.", site: 'app/rsvp/[token]/page.js', kind: 'chunk' },
  { id: 'R4', text: 'Press and hold, then drag to schedule across the peak', site: 'app/components/tutorial/simulated/ScheduleDemo.js', kind: 'chunk' },
  { id: 'R5', text: 'Game detail page — event fetch', site: 'app/gameDetail/page.js', kind: 'chunk' },
  // D-47 (ratified 2026-10-05)
  { id: 'FR1', text: "Couldn't load your friend requests", site: 'app/friends/page.js', kind: 'chunk' },
  { id: 'N7', text: "Couldn't load your notifications", site: 'app/components/NotificationBell.js', kind: 'chunk' },
  { id: 'N8a', text: 'Accept invite to {group}', site: 'app/components/NotificationBell.js', kind: 'fragments', fragments: ['Accept invite to ', ''] },
  { id: 'N8b', text: 'Decline invite to {group}', site: 'app/components/NotificationBell.js', kind: 'fragments', fragments: ['Decline invite to ', ''] },
  { id: 'N8c', text: 'Accept friend request from {name}', site: 'app/components/NotificationBell.js', kind: 'fragments', fragments: ['Accept friend request from ', ''] },
  { id: 'N8d', text: 'Decline friend request from {name}', site: 'app/components/NotificationBell.js', kind: 'fragments', fragments: ['Decline friend request from ', ''] },
  { id: 'R9', text: "We couldn't confirm your RSVP. Sign in and open the event to check your answer.", site: 'app/rsvp/[token]/page.js', kind: 'chunk' },
  { id: 'G7', text: "Couldn't load this group", site: 'app/groupHomePage/page.js', kind: 'chunk' },
  { id: 'G8', text: "Couldn't load this group's events", site: 'app/groupHomePage/page.js', kind: 'chunk' },
  { id: 'S1a', text: 'Sort order: ascending', site: 'app/components/GroupGamesList.js', kind: 'chunk' },
  { id: 'S1b', text: 'Sort order: descending', site: 'app/components/GroupGamesList.js', kind: 'chunk' },
  // C7: `Creating...` is checked at createEvent.js only — createGroup.js ships its own.
  { id: 'C7a', text: 'Creating...', site: 'app/components/createEvent.js', kind: 'chunk' },
  { id: 'C7b', text: 'Updating...', site: 'app/components/createEvent.js', kind: 'chunk' },
  { id: 'P7', text: 'Adding...', site: 'app/userProfile/page.js', kind: 'chunk' },
  { id: 'P8', text: "Couldn't load your collection", site: 'app/userProfile/page.js', kind: 'chunk' },
  { id: 'E15', text: "Couldn't load the game vote", site: 'app/components/BallotSection.js', kind: 'chunk' },
  { id: 'B1', text: 'Some personal controls are still unavailable.', site: 'components/ui/FetchErrorBanner.tsx', kind: 'chunk' },
  { id: 'RF1', text: "Couldn't refresh. Showing what loaded earlier.", site: 'components/ui/FetchErrorBanner.tsx', kind: 'chunk' },
  { id: 'F7', text: 'Found {name}.', site: 'app/friends/page.js', kind: 'fragments', fragments: ['Found ', '.'] },
  { id: 'X3r', text: "We couldn't send that request.", site: 'app/components/FriendInvitePanel.js', kind: 'chunk' },
  { id: 'Q1a', text: 'Loading your games...', site: 'app/components/BringGamePicker.js', kind: 'chunk' },
  { id: 'Q1b', text: '{n} games loaded. / 1 game loaded.', site: 'app/components/BringGamePicker.js', kind: 'fragments', fragments: ['game', 'games', ' loaded.'] },
  // Ratified 2026-10-13 to 2026-10-15 (CONTEXT D-59, D-64)
  { id: 'GD1', text: "Couldn't load reviews.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'GD2', text: "Couldn't load game sessions.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E16', text: "Couldn't load who's coming.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E17', text: "Couldn't load who's replied.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'E18', text: "Couldn't load who's bringing games.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'GD3', text: "Couldn't load your RSVPs.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'GD4', text: "Couldn't load your group role.", site: 'app/gameDetail/page.js', kind: 'chunk' },
  { id: 'N9', text: 'Declined invite to {group}.', site: 'app/components/NotificationBell.js', kind: 'fragments', fragments: ['Declined invite to ', '.'] },
  { id: 'N10', text: 'Declined friend request.', site: 'app/components/NotificationBell.js', kind: 'chunk' },
  { id: 'G9', text: 'Filter by owner', site: 'app/components/GroupLibrary.js', kind: 'chunk' },
  { id: 'F8a', text: 'Found {N} games.', site: 'app/userProfile/page.js', kind: 'fragments', fragments: ['Found ', ' games.'] },
  { id: 'F8b', text: 'Found 1 game.', site: 'app/userProfile/page.js', kind: 'chunk' },
  { id: 'C8', text: 'Group availability', site: 'app/components/EventHeatmapBackground.js', kind: 'chunk' },
  // Ratified 2026-10-17 to 2026-10-18 at the phase close (close ledger rows; plan 88.6.1-65 Task 2)
  { id: 'P14', text: 'Loading responses...', site: 'app/components/ResponseDashboard.js', kind: 'chunk' },
  // Not changing (the copy table's list; deferred register :238)
  { id: 'NC-1', text: 'Press again to confirm: {item}', site: 'app/components/KebabMenu.js', kind: 'fragments', fragments: ['Press again to confirm: ', ''] },
  { id: 'NC-2', text: 'Confirmation cancelled.', site: 'app/components/KebabMenu.js', kind: 'chunk' },
  { id: 'NC-3', text: '{n} results available', site: 'components/ui/Combobox.tsx', kind: 'fragments', fragments: [' result', '', 's', ' available'] },
  { id: 'NC-4', text: 'Invite link copied to the clipboard.', site: 'app/components/FriendInvitePanel.js', kind: 'chunk' },
];

// The exact roster: a dropped or renamed row fails.
const EXPECTED_IDS = [
  'H1', 'H2', 'H3', 'H4', 'H5', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'T2', 'T3', 'T4',
  'A1', 'A2', 'A3', 'A4', 'A5', 'C1', 'C2', 'E1', 'E2', 'E3', 'E4', 'E4b', 'E5', 'E6',
  'E8', 'E9', 'E10', 'E11', 'E12', 'E13', 'E14', 'E15', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6',
  'G7', 'G8', 'P1', 'P2', 'P7', 'P8', 'F1', 'F2', 'F7', 'L1a', 'L1b', 'L1c', 'L2', 'X1',
  'X3', 'X3r', 'R1', 'R2', 'R3', 'R4', 'R5', 'R9', 'FR1', 'N7', 'N8a', 'N8b', 'N8c', 'N8d',
  'S1a', 'S1b', 'C7a', 'C7b', 'B1', 'RF1', 'Q1a', 'Q1b', 'NC-1', 'NC-2', 'NC-3', 'NC-4',
  // owner rulings 2026-10-13 to 2026-10-15
  'GD1', 'GD2', 'E16', 'E17', 'E18', 'GD3', 'GD4', 'N9', 'N10', 'G9', 'F8a', 'F8b', 'C8',
  // close rulings 2026-10-17 to 2026-10-18
  'P14',
];

// Rows that ship no literal of their own.
const NO_LITERAL = [
  { none: 'E7', reason: 'the card is named by the game name itself (data, not copy)' },
  { none: 'X2', reason: "a mechanism (isCsrfRejection routes to that screen's ordinary line), pinned by plan 07" },
  { none: 'T1', reason: 'struck with plan 88.6.1-46 by D-49; carried to the v2.1 tutorial rewrite' },
];

interface Importer {
  importer: string;
  file: string;
  constant: string;
  // the module the constant is imported from; absent = defined and used in `file` itself
  from?: string;
  minUses: number;
  // sentences this file must NOT carry a copy of
  noCopyOf?: string[];
}
const IMPORTERS: Importer[] = [
  { importer: 'E6', file: 'app/components/EventDayModal.js', constant: 'SHARE_GAME_QR_LOADING_LABEL', from: './shareGameQrCopy', minUses: 1 },
  { importer: 'E6', file: 'app/gameDetail/page.js', constant: 'SHARE_GAME_QR_LOADING_LABEL', from: '../components/shareGameQrCopy', minUses: 1 },
  { importer: 'F2', file: 'app/components/FeedbackButton.js', constant: 'FEEDBACK_SEND_FAILED_COPY', from: './FeedbackForm', minUses: 1 },
  { importer: 'E9/R6', file: 'app/components/BringGamePicker.js', constant: 'EMPTY_COLLECTION_LINE', minUses: 2 },
  { importer: 'N5r', file: 'app/friends/page.js', constant: 'ACCEPT_FRIEND_FAILED_COPY', from: '../components/NotificationBell', minUses: 1, noCopyOf: ["We couldn't accept that friend request. Please try again."] },
  { importer: 'N6r', file: 'app/friends/page.js', constant: 'DECLINE_FRIEND_FAILED_COPY', from: '../components/NotificationBell', minUses: 1, noCopyOf: ["We couldn't decline that friend request. Please try again."] },
];

type RetiredScope = 'tree' | string[];
interface Retired {
  text: string;
  scope: RetiredScope;
  // whole: retired only as a WHOLE chunk or a whole JSX text (the bare loaders); else substring
  whole?: boolean;
}
const LOADING_SITES = [
  'app/page.js', 'app/invite/accept/page.js', 'app/invite/group/[token]/page.js',
  'app/invite/game/[token]/page.js', 'app/components/PromptScheduleSection.js',
  'app/groupPlanning/page.js', 'app/restore/group/[token]/page.tsx', 'app/gameDetail/page.js',
  'app/components/EventDayModal.js',
];
const RETIRED_LITERALS: Retired[] = [
  { text: 'Reset QR link', scope: 'tree' },
  { text: 'Refresh the page to sign back in', scope: 'tree' },
  { text: 'if-need-be slots selected', scope: 'tree' },
  { text: 'Could not save your vote', scope: 'tree' },
  { text: 'Could not set the winner', scope: 'tree' },
  { text: 'Failed to send request', scope: 'tree' },
  { text: 'Loading game details...', scope: 'tree' },
  { text: 'No games in your collection.', scope: 'tree' },
  { text: 'Below minimum threshold', scope: 'tree' },
  { text: 'Already converted to event', scope: 'tree' },
  { text: 'Availability for ', scope: ['app/components/EventScheduler.tsx', 'app/components/EventHeatmapBackground.js'] },
  { text: 'Reset Token', scope: ['app/components/QRCodeModal.js'] },
  { text: 'Loading...', scope: LOADING_SITES, whole: true },
  { text: 'Loading…', scope: ['app/components/AvailabilityForm.js'], whole: true },
];

// RF1 typed copies (plan 70 contract C7): every test or spec file a consumer plan pins RF1 in.
// `file` is relative to periodictabletop/. Attributed by `git log -S` on the sentence.
const RF1_TYPED_COPIES = [
  { consumer: '88.6.1-30', file: 'src/app/components/PromptScheduleManager.test.tsx' },
  { consumer: '88.6.1-30', file: 'src/app/components/PromptScheduleReadOnly.test.tsx' },
  { consumer: '88.6.1-30', file: 'e2e/recurring-checkins-phone.spec.ts' },
  { consumer: '88.6.1-56', file: 'src/app/components/GroupGamesList.emptyState.test.tsx' },
  { consumer: '88.6.1-56', file: 'e2e/group-games-failed-refresh.spec.ts' },
  { consumer: '88.6.1-59', file: 'src/app/userProfile/page.test.tsx' },
  { consumer: '88.6.1-59', file: 'e2e/profile-pressed-controls.spec.ts' },
  { consumer: '88.6.1-62', file: 'src/app/userHome/UserHomePage.calendarSheet.test.tsx' },
  { consumer: '88.6.1-62', file: 'src/app/components/UpcomingEventsCard.test.tsx' },
  { consumer: '88.6.1-62', file: 'e2e/home-group-list-refresh.spec.ts' },
  { consumer: '88.6.1-67', file: 'src/app/userProfile/page.test.tsx' },
  { consumer: '88.6.1-70', file: 'src/components/ui/FetchErrorBanner.refresh.test.tsx' },
  { consumer: '88.6.1-71', file: 'src/app/groupHomePage/groupHomePage.identity.test.tsx' },
  { consumer: '88.6.1-71', file: 'e2e/group-home-load-failures.spec.ts' },
  { consumer: '88.6.1-72', file: 'src/app/friends/page.test.tsx' },
  { consumer: '88.6.1-72', file: 'e2e/friends-page.spec.ts' },
  { consumer: '88.6.1-73', file: 'src/app/components/EventCalendar.refresh.test.tsx' },
  { consumer: '88.6.1-73', file: 'src/app/components/ResponseDashboard.test.tsx' },
  { consumer: '88.6.1-73', file: 'e2e/response-dashboard-remind.spec.ts' },
  { consumer: '88.6.1-74', file: 'src/app/gameDetail/page.test.tsx' },
  { consumer: '88.6.1-74', file: 'e2e/gamedetail-refresh-failed.spec.ts' },
  { consumer: '88.6.1-75', file: 'src/app/components/OpenPollsList.test.tsx' },
  { consumer: '88.6.1-75', file: 'src/app/components/emptyStates.split.test.tsx' },
  { consumer: '88.6.1-75', file: 'e2e/check-ins-end-focus.spec.ts' },
  { consumer: '88.6.1-77', file: 'src/app/components/grouplist.refresh.test.tsx' },
  { consumer: '88.6.1-77', file: 'e2e/home-group-list-refresh.spec.ts' },
  { consumer: '88.6.1-78', file: 'src/app/components/ManageMembers.mutations.test.tsx' },
  { consumer: '88.6.1-78', file: 'e2e/manage-members-refresh.spec.ts' },
  { consumer: '88.6.1-79', file: 'src/app/userProfile/page.test.tsx' },
  { consumer: '88.6.1-79', file: 'e2e/profile-identity-refresh.spec.ts' },
];
const RF1_CONSUMER_PLANS = ['30', '56', '59', '62', '67', '71', '72', '73', '74', '75', '77', '78', '79'];

const MAX_FRAGMENT_GAP = 3;
const fileCache = new Map<string, string>();
function read(abs: string): string {
  let text = fileCache.get(abs);
  if (text === undefined) {
    text = fs.readFileSync(abs, 'utf8');
    fileCache.set(abs, text);
  }
  return text;
}
function readSrc(rel: string): string {
  return read(path.join(SRC, rel));
}
function unescape(raw: string): string {
  return raw.replace(/\\(['"\\])/g, '$1');
}
function chunksOf(src: string): string[] {
  return stringChunks(src).map((c) => unescape(c.text));
}
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ');
}

// true when the static parts appear in order, each within MAX_FRAGMENT_GAP of the last.
function fragmentsMatch(chunks: string[], fragments: string[]): boolean {
  for (let start = 0; start < chunks.length; start += 1) {
    if (chunks[start] !== fragments[0]) continue;
    let at = start;
    let ok = true;
    for (let k = 1; k < fragments.length && ok; k += 1) {
      let found = -1;
      for (let j = at + 1; j <= at + 1 + MAX_FRAGMENT_GAP && j < chunks.length; j += 1) {
        if (chunks[j] === fragments[k]) {
          found = j;
          break;
        }
      }
      if (found < 0) ok = false;
      else at = found;
    }
    if (ok) return true;
  }
  return false;
}

function rowMatches(row: RatifiedRow, src: string): boolean {
  const chunks = chunksOf(src);
  if (row.kind === 'chunk') return chunks.includes(row.text);
  if (row.kind === 'fragments') return fragmentsMatch(chunks, row.fragments ?? []);
  const code = collapse(withoutComments(src));
  return (
    (row.parts ?? []).every((p) => chunks.includes(p)) &&
    (row.code ?? []).every((c) => code.includes(collapse(c)))
  );
}

function walkAll(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walkAll(full));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const RF1 = RATIFIED_ROWS.find((r) => r.id === 'RF1')!.text;

describe('AC-33 copy gate: every ratified string at its site (D-30, D-32, D-47)', () => {
  it.each(RATIFIED_ROWS)('$id is byte-equal at $site', (row) => {
    expect(row.text.includes(CURLY), `${row.id} must be written with the straight apostrophe`).toBe(false);
    expect(fs.existsSync(path.join(SRC, row.site)), `${row.id}: ${row.site} is missing`).toBe(true);
    expect(rowMatches(row, readSrc(row.site)), `${row.id} "${row.text}" is not at ${row.site}`).toBe(true);
  });

  it('the row roster is exact (96 ids, no duplicates; E7, X2 and T1 carry no literal)', () => {
    const ids = RATIFIED_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
    expect(ids).toHaveLength(96);
    expect(NO_LITERAL.map((n) => n.none).sort()).toEqual(['E7', 'T1', 'X2']);
    for (const n of NO_LITERAL) expect(ids).not.toContain(n.none);
  });

  it('anti-vacuity: the matcher refuses a one-character change and accepts the row unchanged', () => {
    const row = RATIFIED_ROWS.find((r) => r.id === 'GD1')!;
    const src = readSrc(row.site);
    expect(rowMatches(row, src)).toBe(true);
    expect(rowMatches({ ...row, text: row.text.replace('reviews', 'reviewz') }, src)).toBe(false);
    const tpl = RATIFIED_ROWS.find((r) => r.id === 'N9')!;
    expect(rowMatches(tpl, readSrc(tpl.site))).toBe(true);
    expect(rowMatches({ ...tpl, fragments: ['Declined invite to ', '!'] }, readSrc(tpl.site))).toBe(false);
  });
});

describe('AC-33 importers: a reused constant is imported, never retyped', () => {
  it.each(IMPORTERS)('$importer: $file uses $constant', (imp) => {
    const code = withoutComments(readSrc(imp.file));
    if (imp.from) {
      const esc = imp.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`import\\s*\\{[^}]*\\b${imp.constant}\\b[^}]*\\}\\s*from\\s*['"]${esc}['"]`);
      expect(re.test(code), `${imp.file} does not import ${imp.constant} from ${imp.from}`).toBe(true);
    }
    const all = code.match(new RegExp(`\\b${imp.constant}\\b`, 'g')) ?? [];
    // one occurrence is the import or the definition; the rest are uses
    expect(all.length - 1).toBeGreaterThanOrEqual(imp.minUses);
    for (const sentence of imp.noCopyOf ?? []) {
      expect(chunksOf(readSrc(imp.file)), `${imp.file} retypes "${sentence}"`).not.toContain(sentence);
    }
  });
});

describe('D-32 R8: no curly apostrophe in any non-comment source text', () => {
  it('every source file, comments stripped (strings, template chunks and JSX text)', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = withoutComments(read(file));
      let at = code.indexOf(CURLY);
      while (at >= 0) {
        hits.push(`${path.relative(SRC, file)}:${code.slice(0, at).split('\n').length}`);
        at = code.indexOf(CURLY, at + 1);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('AC-33 retired literals are gone', () => {
  it.each(RETIRED_LITERALS)('"$text" is gone', (ret) => {
    const files = ret.scope === 'tree' ? sourceFiles(SRC) : ret.scope.map((rel) => path.join(SRC, rel));
    const hits: string[] = [];
    for (const file of files) {
      expect(fs.existsSync(file), `${file} is missing`).toBe(true);
      const src = read(file);
      const code = withoutComments(src);
      if (ret.whole) {
        const esc = ret.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const jsxText = new RegExp(`>\\s*${esc}\\s*<`);
        if (chunksOf(src).includes(ret.text) || jsxText.test(code)) hits.push(path.relative(SRC, file));
      } else if (code.includes(ret.text)) {
        hits.push(path.relative(SRC, file));
      }
    }
    expect(hits).toEqual([]);
  });

  it('SuggestionCard.js and its strings are deleted (R14)', () => {
    expect(fs.existsSync(path.join(SRC, 'app/components/SuggestionCard.js'))).toBe(false);
  });
});

describe('D-51 / plan 70 contract C7: RF1 has one definition and every consumer types it', () => {
  it('exactly one source file defines RF1, and it is FetchErrorBanner.tsx (REFRESH_FAILED_NOTICE)', () => {
    const definers = sourceFiles(SRC).filter((f) => chunksOf(read(f)).includes(RF1));
    expect(definers.map((f) => path.relative(SRC, f))).toEqual([path.join('components', 'ui', 'FetchErrorBanner.tsx')]);
    expect(withoutComments(read(definers[0]))).toMatch(/const REFRESH_FAILED_NOTICE\s*=/);
  });

  it('the roster holds at least one typed copy for each of the thirteen consumer plans', () => {
    const plans = new Set(RF1_TYPED_COPIES.map((c) => c.consumer.replace('88.6.1-', '')));
    for (const p of RF1_CONSUMER_PLANS) expect(plans.has(p), `consumer plan ${p} has no typed copy`).toBe(true);
  });

  it.each(RF1_TYPED_COPIES)('$consumer: $file types RF1 with the straight apostrophe', ({ file }) => {
    const abs = path.resolve(SRC, '..', file);
    expect(fs.existsSync(abs), `${file} is missing`).toBe(true);
    expect(read(abs).includes(RF1), `${file} does not type "${RF1}"`).toBe(true);
  });

  it('no test or spec file but this suite types RF1 with U+2019', () => {
    const curly = `Couldn${CURLY}t refresh`;
    const hits = [...walkAll(SRC), ...walkAll(E2E)]
      .filter((f) => path.resolve(f) !== SELF)
      .filter((f) => read(f).includes(curly))
      .map((f) => path.relative(SRC, f));
    expect(hits).toEqual([]);
  });
});
