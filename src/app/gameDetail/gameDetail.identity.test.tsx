// Phase 87.3-04 (Req 4): render-gating regression net for the :1892 own-review
// bug. gameDetail's own-review edit affordance is gated on the is-me derive
// `review.User?.id === selfUuid` (previously `=== user?.sub`, UUID-vs-sub, which
// was ALWAYS false — so own-review edit/delete never rendered). This test proves
// the affordance renders for the review whose nested `User.id` equals the
// resolved self UUID and NOT for another user's review — and that the compare
// (not review position) is what drives it (the two cases swap which review the
// UUID matches).
import * as React from 'react';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

// Mutable self-identity the mocked hook reads, so each case can point the
// resolved UUID at a different review (proves the COMPARE drives the gate).
const h = vi.hoisted(() => ({
  self: { id: '', user_id: '' } as { id: string; user_id: string } | undefined,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.self?.id,
    self: h.self,
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('game_id=GAME1&group_id=GROUP1'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self-sub' }, isLoading: false }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/app/components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({ getStatus: () => 'none', sendRequest: vi.fn() }),
}));

// Stub the heavy/self-fetching children — this test only exercises the reviews
// surface. ClickableMemberName is stubbed to a plain span so the friendship
// provider is not needed for the author name.
vi.mock('@/app/components/RsvpSection', () => ({ default: () => null }));
vi.mock('@/app/components/BallotSection', () => ({ default: () => null }));
vi.mock('@/app/components/BringGamePicker', () => ({ default: () => null }));
vi.mock('@/app/components/BringSummary', () => ({ default: () => null }));
vi.mock('@/app/components/createEvent', () => ({ default: () => null }));
vi.mock('@/app/components/GameSuggestionCard', () => ({ default: () => null }));
vi.mock('@/app/components/QRCodeModal', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/StarRatingPicker', () => ({ default: () => null }));
vi.mock('@/app/components/ClickableMemberName', () => ({
  default: ({ username }: { username?: string }) => <span>{username}</span>,
}));

// Keep ApiError/ApiErrorCode REAL (the real useFetchErrorState reads them);
// stub only the network-call surfaces gameDetail imports.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    gamesAPI: { getGame: vi.fn() },
    eventsAPI: { getGroupEvents: vi.fn(), getEvent: vi.fn() },
    gameReviewsAPI: { getGameReviews: vi.fn(), submitReview: vi.fn() },
    groupsAPI: { getGroupMembers: vi.fn() },
    rsvpAPI: { getEventRsvps: vi.fn() },
    eventBringsAPI: { getEventBrings: vi.fn() },
    suggestionsAPI: { getEventSuggestions: vi.fn() },
    invitesAPI: { sendParticipantInvite: vi.fn() },
  };
});

import GameDetailPage from './page';
import { gamesAPI, eventsAPI, gameReviewsAPI, groupsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const GAME = {
  id: 'GAME1',
  name: 'Wingspan',
  description: 'A bird game',
  image_url: '',
  is_custom: false,
  min_players: 1,
  max_players: 5,
  playing_time: 60,
  theme: 'Nature',
  year_published: 2019,
  bgg_id: 266192,
};

const OWN_REVIEW = {
  id: 'rev-own',
  User: { id: SELF_UUID, username: 'Me', user_id: 'auth0|self-sub' },
  rating: 4,
  review_text: 'My own review text',
  is_recommended: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const OTHER_REVIEW = {
  id: 'rev-other',
  User: { id: OTHER_UUID, username: 'Someone Else', user_id: 'auth0|other' },
  rating: 3,
  review_text: 'Another persons review',
  is_recommended: false,
  createdAt: '2026-01-02T00:00:00Z',
};

const ROSTER = [
  { id: SELF_UUID, username: 'Me', user_id: 'auth0|self-sub', UserGroup: { role: 'member' } },
  { id: OTHER_UUID, username: 'Someone Else', user_id: 'auth0|other', UserGroup: { role: 'member' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.self = { id: SELF_UUID, user_id: 'auth0|self-sub' };
  (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
  (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([OWN_REVIEW, OTHER_REVIEW]);
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
});

afterEach(cleanup);

/** The "own review" block is the one carrying the literal "(You)" marker. */
async function findOwnReviewBlock(): Promise<HTMLElement> {
  const youMarker = await screen.findByText('(You)');
  const block = youMarker.closest('div.border-l-4');
  if (!block) throw new Error('own-review block (div.border-l-4) not found');
  return block as HTMLElement;
}

describe('gameDetail own-review render gate (:1892 fix, Req 4)', () => {
  it('renders the edit affordance on the review whose User.id === selfUuid', async () => {
    render(<GameDetailPage />);

    const ownBlock = await findOwnReviewBlock();
    // The Edit affordance + own review text live in the self-review block.
    expect(within(ownBlock).getByText('My own review text')).toBeInTheDocument();
    expect(within(ownBlock).getByText('Edit')).toBeInTheDocument();
    // The other user's review is NOT the self-review block.
    expect(within(ownBlock).queryByText('Another persons review')).not.toBeInTheDocument();
  });

  it('does NOT render an edit affordance on another user\'s review', async () => {
    render(<GameDetailPage />);

    // Both reviews are on the page...
    expect(await screen.findByText('My own review text')).toBeInTheDocument();
    expect(screen.getByText('Another persons review')).toBeInTheDocument();
    // ...but exactly ONE edit affordance exists (the own-review one).
    expect(screen.getAllByText('Edit')).toHaveLength(1);
  });

  it('follows the UUID, not review position: when selfUuid matches the OTHER review, the edit gate moves to it', async () => {
    // Point the resolved identity at the other review's author.
    h.self = { id: OTHER_UUID, user_id: 'auth0|other' };

    render(<GameDetailPage />);

    const ownBlock = await findOwnReviewBlock();
    // Now the "own" (editable) review is the one whose User.id === OTHER_UUID.
    expect(within(ownBlock).getByText('Another persons review')).toBeInTheDocument();
    expect(within(ownBlock).getByText('Edit')).toBeInTheDocument();
    expect(within(ownBlock).queryByText('My own review text')).not.toBeInTheDocument();
    // Still exactly one edit affordance.
    expect(screen.getAllByText('Edit')).toHaveLength(1);
  });

  it('does not flag any review as own while identity is unresolved (loading, not "not me")', async () => {
    // Unresolved identity — selfUuid undefined. The is-me derive must read as
    // indeterminate: no review is flagged own, so no "(You)" / edit affordance.
    h.self = undefined;

    render(<GameDetailPage />);

    // Wait for the reviews to load so we know we're past the loading gate.
    await waitFor(() =>
      expect(screen.getByText('Another persons review')).toBeInTheDocument()
    );
    expect(screen.getByText('My own review text')).toBeInTheDocument();
    // No own-review affordance surfaced from an unresolved identity.
    expect(screen.queryByText('(You)')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });
});
