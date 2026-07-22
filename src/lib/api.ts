/**
 * API Configuration and Utility Functions
 * Centralized API base URL and common fetch patterns
 */

import type { Group, GroupList, GroupMemberList, GroupInvitePreview } from './schemas/groups';
import type {
  Event,
  EventList,
  RsvpList,
  EventBringList,
  Ballot,
} from './schemas/events';
import type { User } from './schemas/users';
import type { Availability, AvailabilityList } from './schemas/availability';
import type { GameList, UserGameList } from './schemas/shared';

// Absolute backend origin. Used ONLY by PUBLIC/unauthenticated callers that must
// bypass the BFF proxy (magic-link, invite-preview, public RSVP respond,
// invite-info). Authenticated calls go through apiFetch -> same-origin '/api'
// (BFF_BASE), where the catch-all route attaches the Auth0 token SERVER-SIDE
// (FSEC-01) — the raw token never reaches client JS.
export const PUBLIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

// Back-compat alias for external direct-fetch callers (e.g. the public /feedback
// submit in FeedbackForm.js). Same absolute backend origin as PUBLIC_API_BASE_URL
// — NOT the same-origin BFF. New public callers should reference PUBLIC_API_BASE_URL.
export const API_BASE_URL = PUBLIC_API_BASE_URL;

// Same-origin BFF base for AUTHENTICATED apiFetch calls. The catch-all route
// handler (app/api/[...path]/route.ts) attaches the Auth0 access token
// server-side; apiFetch itself sends no bearer.
const BFF_BASE = '/api';

// -----------------------------------------------------------------------------
// ApiError seam (D-07). ALL prose-matching lives in `mapErrorToCode`. When
// BAPI-01 ships the real envelope (Phase 85/86), the swap is a one-function
// rewrite — call sites NEVER change (they only read `err.code`).
// Source: 82-RESEARCH.md Pattern 2 (verbatim).
// -----------------------------------------------------------------------------
// The full wire vocabulary. Envelope-PREFERRED (Decision A, 2026-06-30):
//   - BE registry codes (Phase 85 ERROR_REGISTRY): validation, unauthorized,
//     forbidden, not_found, rate_limited, token_invalid, prompt_closed,
//     prompt_deadline_expired, reminder_cooldown, internal.
//   - client-side codes apiFetch itself throws: `network` (fetch/connect
//     failure) and `config` (misconfiguration). These are ADDITIVE — the widen
//     over the BE registry must NOT drop them (86-04 Task 1 / MED #6).
//   - `unknown` is the terminal fallback for an unmapped status.
//   - account-deletion codes (Phase 87.2, registered in the BE ERROR_REGISTRY):
//     `owner_of_active_groups` (@409 — the caller still owns active groups and
//     must transfer/delete them first; carries a blocked-groups list nested at
//     details.groups) and `account_deleted` (@410 — repeat-DELETE / tombstone
//     refusal, terminal). Both MUST be in the union or `mapErrorToCode`'s
//     body.code preference yields a code outside ApiErrorCode.
export type ApiErrorCode =
  | 'unknown'
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'token_invalid'
  | 'prompt_closed'
  | 'prompt_deadline_expired'
  | 'reminder_cooldown'
  | 'owner_of_active_groups'
  | 'account_deleted'
  | 'internal'
  | 'network'
  | 'config';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, code: ApiErrorCode, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype); // instanceof works post-transpile
  }
}

/**
 * Typed accessor for the Phase 85 envelope's OWN `details` object.
 *
 * The single apiFetch throw site stores the WHOLE parsed error body as
 * `ApiError.details` (see the in-code comment at the throw site), and the BE
 * envelope shape is `{ code, message, details: { ... }, error }`. So the
 * envelope's structured payload (e.g. the owner-gate blocked-groups list) is
 * NESTED at `err.details.details`, NOT `err.details`. Consumers must read it
 * through this one seam instead of hand-casting the double-nesting — reading
 * `err.details.groups` directly is always `undefined` and renders a dead-end.
 */
export function getEnvelopeDetails<T>(err: ApiError): T | undefined {
  return (err.details as { details?: T } | undefined)?.details;
}

/**
 * The GET /users/me/deletion-blockers pre-flight shape (Phase 87.2). Resolves
 * 200 for any authenticated caller — `groups` is empty when not blocked and
 * non-empty (each group's TOTAL member count) when the caller owns active
 * groups. `memberCount` is the group's whole-membership count (pinned in plan
 * 87.2-04) — render it as the member count, NOT an "others" count. This
 * endpoint NEVER rejects with `owner_of_active_groups`; that code arrives only
 * on the DELETE response (the server-side TOCTOU re-check, D-10).
 */
export interface DeletionBlockerGroup {
  id: string;
  name: string;
  memberCount: number;
}
export interface DeletionBlockers {
  groups: DeletionBlockerGroup[];
}

/**
 * The DELETE /users/me 409 `owner_of_active_groups` envelope `details` shape
 * (read via getEnvelopeDetails, i.e. nested at err.details.details).
 * `google_access_revoked` is a fixed FE/BE contract key: the backend sets it
 * (true) ONLY when the deletion was blocked at the last-moment in-transaction
 * owner re-check, AFTER the user's Google Calendar integration was already
 * irreversibly revoked (WR-02) — the FE must tell the user to reconnect.
 */
export interface DeleteAccountBlockedDetails {
  groups?: DeletionBlockerGroup[];
  google_access_revoked?: boolean;
}

// HTTP-status -> code fallback for routes NOT yet emitting the envelope `code`.
// ~497 BE routes still return a raw `{ error }` (no `code`) until Phase 93 /
// BAPI-03 converts them; this gives them a sensible code (and therefore correct
// retry classification) in the meantime. Mirrors the BE ERROR_REGISTRY httpStatus
// map so a status-mapped 429 lands on `rate_limited` (non-retryable) etc.
function statusToCode(status: number): ApiErrorCode {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'internal';
  return 'unknown';
}

// ENVELOPE-PREFERRED (Decision A, 2026-06-30). Consume the Phase 85 envelope
// `body.code` when present; OTHERWISE map the HTTP status to a code so
// unconverted raw-`{ error }` routes still get a real code. Never throws on a
// raw `{ error }` body. Call sites NEVER change — they only read err.code.
export function mapErrorToCode(body: any, status: number): ApiErrorCode {
  if (body && typeof body.code === 'string') return body.code as ApiErrorCode; // PREFERRED: envelope code
  // Legacy validation hint: a body carrying a top-level errors[] (the Phase 85
  // legacy mirror, or an old raw validation body) is a validation failure
  // regardless of status. Retained as a FALLBACK for unconverted routes.
  if (body?.errors && Array.isArray(body.errors)) return 'validation';
  return statusToCode(status); // FALLBACK: HTTP-status -> code
}

// Envelope-PREFERRED human message. Prefer the envelope `body.message`; fall
// back to the legacy `body.error` alias (RETAINED for the ~497 unconverted
// routes until Phase 93 / BAPI-03 removes both sides). This is the fallback
// chain the acceptance criteria pins.
function extractErrorMessage(body: any, status: number): string {
  return body?.message ?? body?.error ?? `HTTP error! status: ${status}`;
}

// Envelope-PREFERRED validation field-errors. Prefer `body.details.errors`
// (Phase 85 envelope); fall back to the top-level legacy `body.errors[]` mirror
// (RETAINED for unconverted routes until Phase 93).
function extractFieldErrors(body: any): any[] | undefined {
  const fieldErrors = body?.details?.errors ?? body?.errors;
  return Array.isArray(fieldErrors) ? fieldErrors : undefined;
}

/**
 * Direct-to-backend fetch for PUBLIC/unauthenticated callers (invite-preview,
 * invite-info, and other no-Auth0 flows). Targets the absolute backend origin
 * (PUBLIC_API_BASE_URL) so a logged-out caller NEVER hits the BFF proxy's
 * server-side getAccessToken(). Mirrors apiFetch's JSON-parse + ApiError throw
 * contract via the shared ApiError/mapErrorToCode seam, so callers converted
 * from apiFetch keep their exact return/error shape.
 */
export async function publicFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${PUBLIC_API_BASE_URL}${endpoint}`;
  const defaultOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  };

  let response: Response;
  try {
    response = await fetch(url, { ...defaultOptions, ...options });
  } catch (error) {
    const errName = error instanceof Error ? error.name : '';
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errName === 'TypeError' && errMessage.includes('fetch')) {
      throw new ApiError(
        'Network error: Could not connect to the server. Please check if the backend is running.',
        'network',
        0
      );
    }
    throw error;
  }

  const responseText = await response.text();
  if (!response.ok) {
    let errorData: any;
    try {
      errorData = JSON.parse(responseText);
    } catch {
      errorData = { error: responseText || `HTTP error! status: ${response.status}` };
    }
    const msg = extractErrorMessage(errorData, response.status);
    throw new ApiError(msg, mapErrorToCode(errorData, response.status), response.status, errorData);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    return responseText as unknown as T;
  }
}

/**
 * Generic fetch wrapper with error handling.
 *
 * FSEC-01: authenticated calls go to the same-origin BFF ('/api/...'). The
 * catch-all route handler (app/api/[...path]/route.ts) attaches the Auth0 access
 * token SERVER-SIDE — apiFetch sends NO bearer and the token never reaches
 * client JS. PUBLIC/unauthenticated callers must NOT use apiFetch; they bypass
 * the proxy via PUBLIC_API_BASE_URL (see publicFetch / the magic-link helpers).
 */
export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BFF_BASE}${endpoint}`;

  const defaultOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  };

  try {
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    // Read response as text first (can only be read once)
    const responseText = await response.text();
    
    // Check if response is HTML (means we're hitting the wrong endpoint)
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      console.error(`API Error: Received HTML instead of JSON. This usually means NEXT_PUBLIC_API_URL is incorrect.`);
      console.error(`Attempted URL: ${url}`);
      console.error(`Current API_BASE_URL: ${API_BASE_URL}`);
      throw new ApiError(
        `API configuration error: Backend URL appears to be incorrect. Check NEXT_PUBLIC_API_URL environment variable. Current: ${API_BASE_URL}`,
        'config',
        response.status
      );
    }

    if (!response.ok) {
      let errorData: any;
      try {
        // Try to parse as JSON
        errorData = JSON.parse(responseText);
      } catch (jsonError) {
        // If not JSON, use the text as error message
        errorData = { error: responseText || `HTTP error! status: ${response.status}` };
      }

      // The single throw site (D-07). mapErrorToCode is envelope-PREFERRED;
      // the message/field-error reads prefer the envelope and fall back to the
      // legacy aliases (retained until Phase 93). ApiError.details carries the
      // WHOLE body, so envelope `details` is nested at err.details.details.
      // If there are validation errors, format them nicely for the message.
      const fieldErrors = extractFieldErrors(errorData);
      if (fieldErrors && fieldErrors.length > 0) {
        const errorMessages = fieldErrors
          .map((err: any) => err.message || `${err.field}: ${err.msg}`)
          .join('. ');
        const msg = errorMessages || extractErrorMessage(errorData, response.status);
        throw new ApiError(msg, mapErrorToCode(errorData, response.status), response.status, errorData);
      }

      const msg = extractErrorMessage(errorData, response.status);
      throw new ApiError(msg, mapErrorToCode(errorData, response.status), response.status, errorData);
    }

    // Parse successful response as JSON
    try {
      return JSON.parse(responseText) as T;
    } catch (jsonError) {
      // If response is not JSON, return the text
      return responseText as unknown as T;
    }
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`API Error (${endpoint}):`, errMessage || 'Unknown error');
    console.error(`API URL: ${url}`);
    // Re-throw with more context if it's a network error. ANY TypeError thrown
    // by fetch() is a network-level failure per the spec, but the message text
    // is engine-specific — Chrome throws "Failed to fetch", Safari throws
    // "Load failed" — so match on the type alone, never the message (WR-04).
    // Abort/timeout rejections are DOMExceptions, not TypeErrors, and fall
    // through to the raw rethrow below.
    if (error instanceof TypeError) {
      throw new ApiError(
        'Network error: Could not connect to the server. Please check if the backend is running and NEXT_PUBLIC_API_URL is set correctly.',
        'network',
        0
      );
    }
    throw error;
  }
}

/**
 * API functions for Groups
 */
export const groupsAPI = {
  // Get all groups for a user
  getUserGroups: (user_id: string) =>
    apiFetch<GroupList>(`/groups/user/${encodeURIComponent(user_id)}`),

  // Get a single group by ID
  getGroup: (group_id: string) =>
    apiFetch<Group>(`/groups/${group_id}`),

  // Get all users in a group
  getGroupMembers: (group_id: string) =>
    apiFetch<GroupMemberList>(`/groups/${group_id}/users`),

  // Create a new group
  createGroup: (groupData: Record<string, unknown>) =>
    apiFetch<Group>('/groups', {
      method: 'POST',
      body: JSON.stringify(groupData),
    }),

  // Add user to group
  addUserToGroup: (group_id: string, user_id: string) =>
    apiFetch(`/groups/${group_id}/users`, {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),

  // Update user role in group (owner only)
  updateUserRole: (group_id: string, target_user_id: string, role: string) =>
    apiFetch(`/groups/${group_id}/users/${target_user_id}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  // Remove user from group (owner or admin). Authz derives the caller from the
  // Auth0 token (FSEC-02) — no client-supplied caller identity in the body.
  removeUserFromGroup: (group_id: string, target_user_id: string) =>
    apiFetch(`/groups/${group_id}/users/${target_user_id}`, {
      method: 'DELETE',
    }),

  // Update group settings (profile picture, background)
  updateGroupSettings: (group_id: string, settings: Record<string, unknown>) =>
    apiFetch(`/groups/${group_id}/settings`, {
      method: 'PUT',
      body: JSON.stringify({
        ...settings,
      }),
    }),

  // Delete group (owner only)
  deleteGroup: (group_id: string) =>
    apiFetch(`/groups/${group_id}`, {
      method: 'DELETE',
    }),

  // Approve a pending member (owner/admin only)
  approveMember: (group_id: string, target_user_id: string) =>
    apiFetch(`/groups/${group_id}/users/${encodeURIComponent(target_user_id)}/approve`, {
      method: 'POST',
    }),

  // Reject a pending member (owner/admin only)
  rejectMember: (group_id: string, target_user_id: string) =>
    apiFetch(`/groups/${group_id}/users/${encodeURIComponent(target_user_id)}/reject`, {
      method: 'POST',
    }),

  // Leave a group (self-removal, non-owner only)
  leaveGroup: (group_id: string) =>
    apiFetch(`/groups/${group_id}/leave`, {
      method: 'POST',
    }),

  // Transfer group ownership to another active member (owner only)
  transferOwnership: (group_id: string, new_owner_user_id: string) =>
    apiFetch(`/groups/${group_id}/transfer-ownership`, {
      method: 'POST',
      body: JSON.stringify({ new_owner_user_id }),
    }),

  // Get (or lazy-generate) group invite token
  getInviteToken: (group_id: string) =>
    apiFetch(`/groups/${group_id}/invite-token`),

  // Reset group invite token (owner/admin only)
  resetInviteToken: (group_id: string) =>
    apiFetch(`/groups/${group_id}/reset-invite-token`, { method: 'POST' }),

  // Join group by invite token (authenticated)
  joinByToken: (token: string) =>
    apiFetch('/groups/join-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get group invite preview (public, no auth needed) — runs BEFORE the auth
  // check on logged-out invite pages, so it MUST bypass the BFF proxy.
  getInvitePreview: (token: string) =>
    publicFetch<GroupInvitePreview>(`/groups/invite-preview/${token}`),

  // Get the group's shared game library (all members' games, deduplicated with owners)
  getGroupLibrary: (group_id: string) =>
    apiFetch<GameList>(`/groups/${group_id}/library`),
};

/**
 * API functions for Events
 */
export const eventsAPI = {
  // Get all events for a user across all groups
  getUserEvents: (user_id: string, { includeRsvpSummary = false } = {}) =>
    apiFetch<EventList>(`/events/user/${encodeURIComponent(user_id)}${includeRsvpSummary ? '?include_rsvp_summary=true' : ''}`),

  // Get all events for a group
  getGroupEvents: (group_id: string, { includeRsvpSummary = false } = {}) =>
    apiFetch<EventList>(`/events/group/${group_id}${includeRsvpSummary ? '?include_rsvp_summary=true' : ''}`),

  // Get a single event by ID
  getEvent: (event_id: string) =>
    apiFetch<Event>(`/events/${event_id}`),
  
  // Create a new event
  createEvent: (eventData: Record<string, unknown>) => 
    apiFetch('/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    }),
  
  // Update an event (requires owner/admin)
  updateEvent: (event_id: string, eventData: Record<string, unknown>) =>
    apiFetch(`/events/${event_id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...eventData }),
    }),

  // Delete an event (requires owner/admin). Authz derives the caller from the
  // Auth0 token (FSEC-02) — no client-supplied caller identity in the body.
  deleteEvent: (event_id: string) =>
    apiFetch(`/events/${event_id}`, {
      method: 'DELETE',
    }),

  // Remove a single participant from an event (owner/admin only).
  // EVT-08: hard-destroys the EventParticipation row + writes an audit
  // log entry so a subsequent QR re-join is silent (no welcome email).
  // participation_user_id is the User.id (UUID), not the Auth0 string.
  removeParticipation: (event_id: string, participation_user_id: string) =>
    apiFetch(`/events/${event_id}/participations/${participation_user_id}`, {
      method: 'DELETE',
    }),

  // Phase 71.1 GAMP-04 — game-only participant self-leave.
  // Backend DELETE /events/:event_id/participations/:user_id was extended in
  // Plan 71.1-01 to allow self-leave (caller's User.id === participationUserId).
  // user_db_id is the User.id UUID (NOT Auth0 string). Resolved frontend-side
  // from the groupMembers roster (Plan 01 guarantees caller's own row is in
  // the response with UserGroup=null for game-only callers). Distinct helper
  // name from removeParticipation even though the underlying endpoint is
  // shared — semantically leaveEvent is self-action, removeParticipation is
  // admin-action; backend authz decides whether the caller is allowed.
  leaveEvent: (event_id: string, user_db_id: string) =>
    apiFetch(`/events/${event_id}/participations/${user_db_id}`, {
      method: 'DELETE',
    }),

  // Get (or lazy-generate) event invite token
  getEventInviteToken: (event_id: string) =>
    apiFetch(`/events/${event_id}/invite-token`),

  // Join game by invite token (authenticated)
  joinGameByToken: (token: string) =>
    apiFetch('/events/join-game-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get event invite preview (public, no auth needed) — runs BEFORE the auth
  // check on logged-out invite pages, so it MUST bypass the BFF proxy.
  getEventInvitePreview: (token: string) =>
    publicFetch(`/events/invite-preview/${token}`),
};

/**
 * API functions for RSVPs (event responses: yes/no/maybe)
 */
export const rsvpAPI = {
  // Create or update an RSVP for an event
  submitRsvp: (event_id: string, status: string, note?: string) =>
    apiFetch('/rsvp', {
      method: 'POST',
      body: JSON.stringify({ event_id, status, note }),
    }),
  // Get all RSVPs for an event (includes summary counts)
  getEventRsvps: (event_id: string) =>
    apiFetch<RsvpList>(`/rsvp/event/${event_id}`),
  // Get all RSVPs for the current user
  getUserRsvps: (user_id: string) =>
    apiFetch<RsvpList>(`/rsvp/user/${encodeURIComponent(user_id)}`),
  // Remove an RSVP
  removeRsvp: (rsvp_id: string) =>
    apiFetch(`/rsvp/${rsvp_id}`, { method: 'DELETE' }),
};

/**
 * API functions for public RSVP (magic link, no Auth0 required)
 * Uses direct fetch without Auth0 token injection
 */
export const rsvpPublicAPI = {
  // Respond to RSVP via magic link token (no auth required) — direct-to-backend
  // (PUBLIC_API_BASE_URL), never the BFF proxy.
  respondViaToken: (token: string, eventId: string, userId: string, status: string) =>
    fetch(
      `${PUBLIC_API_BASE_URL}/rsvp/respond?token=${encodeURIComponent(token)}&e=${eventId}&u=${encodeURIComponent(userId)}&s=${status}`
    ).then(res => res.json()),
};

/**
 * API functions for Event Brings (who is bringing which games)
 */
export const eventBringsAPI = {
  getEventBrings: (event_id: string) => apiFetch<EventBringList>(`/event-brings/event/${event_id}`),
  updateMyBrings: (event_id: string, game_ids: unknown[]) => apiFetch(`/event-brings/event/${event_id}/my-brings`, {
    method: 'PUT',
    body: JSON.stringify({ game_ids }),
  }),
  removeBring: (bring_id: string) => apiFetch(`/event-brings/${bring_id}`, { method: 'DELETE' }),
};

/**
 * API functions for Users
 */
export const usersAPI = {
  // Get user by user_id (Auth0 identifier).
  // Phase 78 / TZ-01: Optional detectedTimezone is forwarded as ?timezone=...
  // so the backend's GET /:user_id auto-create handler can persist it on first
  // creation OR backfill it for an existing null-timezone user.
  // Pass null/undefined/empty -> the query param is omitted entirely (matching
  // CONTEXT D-Frontend: "On detection failure, omit the field. Do NOT send
  // 'UTC', do NOT send null, do NOT send a placeholder").
  getUser: (user_id: string, detectedTimezone: string | null = null) => {
    const path = `/users/${encodeURIComponent(user_id)}`;
    if (typeof detectedTimezone === 'string' && detectedTimezone.length > 0) {
      return apiFetch<User>(`${path}?timezone=${encodeURIComponent(detectedTimezone)}`);
    }
    return apiFetch<User>(path);
  },
  
  // Update user's username
  updateUsername: (user_id: string, username: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/username`, {
      method: 'PUT',
      body: JSON.stringify({ username }),
    }),
  
  // Search user by email
  searchUserByEmail: (email: string) => 
    apiFetch(`/users/search/email/${encodeURIComponent(email)}`),
  
  // Create or update user
  createOrUpdateUser: (userData: Record<string, unknown>) =>
    apiFetch('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    }),

  // Mark tutorial as completed (with version tracking)
  completeTutorial: (user_id: string, version = 2) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/tutorial`, {
      method: 'PUT',
      body: JSON.stringify({ version }),
    }),

  // Reset tutorial for replay
  resetTutorial: (user_id: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/tutorial`, {
      method: 'DELETE',
    }),

  // Update notification preferences
  updateNotificationPreferences: (user_id: string, preferences: Record<string, unknown>) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/notification-preferences`, {
      method: 'PATCH',
      body: JSON.stringify({ preferences }),
    }),

  // Update user's timezone
  updateTimezone: (user_id: string, timezone: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/timezone`, {
      method: 'PATCH',
      body: JSON.stringify({ timezone }),
    }),

  // Save phone number and initiate verification
  savePhone: (user_id: string, phone: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/phone`, {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  // Verify phone with SMS code
  verifyPhone: (user_id: string, code: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/phone/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // Remove phone number — backend cascades sms_enabled and all 4
  // notification_preferences[type].sms toggles to false in one transaction
  // per CONTEXT D-PHONE-02. Returns the updated user record.
  removePhone: (user_id: string) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/phone`, {
      method: 'DELETE',
    }),

  // Account-deletion pre-flight (Phase 87.2 / D-11). Resolves 200 { groups }
  // for an authenticated caller — empty array when nothing blocks deletion,
  // non-empty (owned active groups + TOTAL member counts) when the owner gate
  // would fire. NEVER rejects with owner_of_active_groups; that arrives only on
  // the DELETE (the server-side TOCTOU re-check). Caller derives from the Auth0
  // token server-side — no user_id in the path (self-scoped /users/me).
  getDeletionBlockers: () =>
    apiFetch<DeletionBlockers>('/users/me/deletion-blockers'),

  // Hard-delete the authenticated account (Phase 87.2). The BFF proxy forwards
  // DELETE with same-origin CSRF checks; caller identity comes from the Auth0
  // token server-side. On success the caller MUST navigate to logout IMMEDIATELY
  // (no toast-then-wait) so no authenticated fetch re-provisions a JIT ghost row.
  deleteAccount: () =>
    apiFetch<{ message: string }>('/users/me', { method: 'DELETE' }),
};

/**
 * API functions for Games
 */
export const gamesAPI = {
  // getGames (GET /games) DELETED — 87.5 review SW-02: zero product callers and
  // the BE route was removed (its ?group_id arm leaked group reviews
  // unauthenticated). Use searchAll / getGamesForEvent / listsAPI.getGroupGames.

  // Get a single game by ID
  getGame: (game_id: string) => 
    apiFetch(`/games/${game_id}`),
  
  // Create a custom game
  createGame: (gameData: Record<string, unknown>) => 
    apiFetch('/games', {
      method: 'POST',
      body: JSON.stringify(gameData),
    }),
  
  // Search BGG for games
  searchBGG: (query: string) => 
    apiFetch(`/games/bgg/search?query=${encodeURIComponent(query)}`),
  
  // Import game from BGG
  importFromBGG: (bgg_id: string) => 
    apiFetch(`/games/import-bgg/${bgg_id}`, {
      method: 'POST',
    }),
  
  // Get games for event form (group played + user owned)
  getGamesForEvent: (group_id: string, user_id: string) =>
    apiFetch(`/games/for-event/${group_id}/${encodeURIComponent(user_id)}`),

  // Search all games (local custom + BGG) for combo input
  searchAll: (query: string, groupId: string, userId: string) => {
    const params = new URLSearchParams({ query });
    if (groupId) params.append('group_id', groupId);
    if (userId) params.append('user_id', userId);
    return apiFetch(`/games/search-all?${params.toString()}`);
  },

  // Resolve a game name to an existing or new custom game
  resolveGame: (name: string) =>
    apiFetch('/games/resolve', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
};

/**
 * API functions for User Owned Games
 */
export const userGamesAPI = {
  // Get all games owned by a user
  getOwnedGames: (user_id: string) =>
    apiFetch<UserGameList>(`/user-games/user/${encodeURIComponent(user_id)}`),
  
  // Add game to user's collection
  addOwnedGame: (user_id: string, game_id: string) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/game/${game_id}`, {
      method: 'POST',
    }),
  
  // Remove game from user's collection
  removeOwnedGame: (user_id: string, game_id: string) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/game/${game_id}`, {
      method: 'DELETE',
    }),
  
  // Import entire BGG collection
  importBGGCollection: (user_id: string, bgg_username: string) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/import-bgg-collection`, {
      method: 'POST',
      body: JSON.stringify({ bgg_username }),
    }),
};

/**
 * API functions for Lists (sorted/filtered game lists)
 */
export const listsAPI = {
  // Get games for a group with sorting options
  // sort: 'name' | 'play_count' | 'last_played' | 'rating'
  // order: 'asc' | 'desc'
  getGroupGames: (group_id: string, user_id: string, sort = 'last_played', order = 'desc') => {
    const params = new URLSearchParams({ sort, order });
    return apiFetch(`/lists/games/${group_id}/${encodeURIComponent(user_id)}?${params.toString()}`);
  },
  
  // Get games by theme
  getByTheme: (group_id: string, theme: string, user_id: string) =>
    apiFetch(`/lists/by-theme/${group_id}/${encodeURIComponent(theme)}/${encodeURIComponent(user_id)}`),
};

/**
 * API functions for Game Reviews
 */
export const gameReviewsAPI = {
  // Get reviews for a game in a group
  getGameReviews: (game_id: string, group_id: string, user_id: string | null = null) => {
    const params = user_id ? `?user_id=${encodeURIComponent(user_id)}` : '';
    return apiFetch(`/game-reviews/game/${game_id}/group/${group_id}${params}`);
  },
  
  // Get all reviews by a user in a group
  getUserReviews: (target_user_id: string, group_id: string) => {
    return apiFetch(`/game-reviews/user/${encodeURIComponent(target_user_id)}/group/${group_id}`);
  },
  
  // Create or update a review
  submitReview: (reviewData: Record<string, unknown>) => 
    apiFetch('/game-reviews', {
      method: 'POST',
      body: JSON.stringify(reviewData),
    }),
  
  // Update a review
  updateReview: (review_id: string, reviewData: Record<string, unknown>) => 
    apiFetch(`/game-reviews/${review_id}`, {
      method: 'PUT',
      body: JSON.stringify(reviewData),
    }),
  
  // Delete a review
  deleteReview: (review_id: string) => 
    apiFetch(`/game-reviews/${review_id}`, {
      method: 'DELETE',
    }),
};

/**
 * API functions for Feedback
 */
export const feedbackAPI = {
  // Submit bug report or suggestion
  submitFeedback: (feedbackData: Record<string, unknown>) =>
    apiFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify(feedbackData),
    }),

  // Submit feedback as a GitHub Issue (contextual feedback button)
  submitGitHubFeedback: (data: Record<string, unknown>) =>
    apiFetch('/feedback/github', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

/**
 * API functions for Google Calendar
 */
export const googleCalendarAPI = {
  // Get Google Calendar connection status
  getStatus: (user_id: string) => 
    apiFetch(`/auth/google/status/${encodeURIComponent(user_id)}`),
  
  // Disconnect Google Calendar
  disconnect: (user_id: string) => 
    apiFetch('/auth/google/disconnect', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),
};

/**
 * API functions for Availability and Planning
 */
export const availabilityAPI = {
  // Get user's availability for a date range
  getUserAvailability: (
    user_id: string,
    startDate: string | null = null,
    endDate: string | null = null,
    timezone: string = 'UTC'
  ) => {
    const params = new URLSearchParams({ timezone });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return apiFetch<AvailabilityList>(`/availability/user/${encodeURIComponent(user_id)}?${params.toString()}`);
  },

  // Get user's availability patterns (for editing/deleting)
  getUserPatterns: (user_id: string) =>
    apiFetch<AvailabilityList>(`/availability/user/${encodeURIComponent(user_id)}/patterns`),
  
  // Create recurring availability schedule
  createRecurringPattern: (user_id: string, patternData: Record<string, unknown>) => 
    apiFetch(`/availability/user/${encodeURIComponent(user_id)}/recurring`, {
      method: 'POST',
      body: JSON.stringify(patternData),
    }),
  
  // Create specific date/time override
  createOverride: (user_id: string, overrideData: Record<string, unknown>) => 
    apiFetch(`/availability/user/${encodeURIComponent(user_id)}/override`, {
      method: 'POST',
      body: JSON.stringify(overrideData),
    }),
  
  // Delete availability pattern/override
  deleteAvailability: (availability_id: string) => 
    apiFetch(`/availability/${availability_id}`, {
      method: 'DELETE',
    }),
  
  // Get overlapping free time for all group members
  getGroupOverlaps: (
    group_id: string,
    startDate: string | null = null,
    endDate: string | null = null,
    timezone: string = 'UTC'
  ) => {
    const params = new URLSearchParams({ timezone });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return apiFetch(`/availability/group/${group_id}/overlaps?${params.toString()}`);
  },

  // Submit weekly availability response
  submitWeeklyAvailability: (group_id: string, data: Record<string, unknown>) =>
    apiFetch(`/availability/groups/${group_id}/weekly`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Get weekly availability for a group
  getWeeklyAvailability: (group_id: string, week_start: string) =>
    apiFetch<Availability>(`/availability/groups/${group_id}/week/${week_start}`),

  // Get merged availability heatmap for a group (1-hour bucketed, 12pm-11pm)
  getGroupHeatmap: (group_id: string, weekStart: string, timezone: string = 'UTC') => {
    const params = new URLSearchParams({ timezone });
    if (weekStart) params.append('week_start', weekStart);
    return apiFetch(`/availability/group/${group_id}/heatmap?${params.toString()}`);
  },
};

/**
 * API functions for Magic Auth (no Auth0 required)
 * These use direct fetch without Auth0 token injection
 */
export const magicAuthAPI = {
  // Validate a magic token (returns user info, prompt_id, expiry)
  validateToken: (token: string, formLoadedAt = null) =>
    fetch(`${PUBLIC_API_BASE_URL}/magic-auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, formLoadedAt }),
    }).then(res => res.json()),

  // Request a new magic link (stub - returns 501 currently)
  requestNew: (promptId: string) =>
    fetch(`${PUBLIC_API_BASE_URL}/magic-auth/request-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId }),
    }).then(res => res.json()),
};

/**
 * API functions for Availability Form submission (magic token auth, no Auth0)
 * These use direct fetch without Auth0 token injection
 */
export const availabilityFormAPI = {
  // Submit availability response via magic token
  submitResponse: (data: Record<string, unknown>) =>
    fetch(`${PUBLIC_API_BASE_URL}/availability-responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),

  // Get existing response for pre-fill (if user returns to edit)
  getExistingResponse: (promptId: string, token: string) =>
    fetch(`${PUBLIC_API_BASE_URL}/availability-responses/${promptId}?magic_token=${encodeURIComponent(token)}`, {
      headers: { 'Content-Type': 'application/json' },
    }).then(res => res.ok ? res.json() : null),

  // Phase 81 Plan 02 (CHKIN-05) — pre-fill the grid from the magic-token user's
  // Google Calendar. Returns { slot_ids: ["ISO datetime", ...], count } for
  // 30-min slots where the user is FREE in the requested week. Magic-token
  // authenticated via body (no Auth0 bearer).
  prefillFromGcal: async ({
    magicToken,
    startDate,
    numDays,
    timezone,
  }: {
    magicToken: string;
    startDate: string;
    numDays: number;
    timezone: string;
  }) => {
    const res = await fetch(`${PUBLIC_API_BASE_URL}/availability-prefill/gcal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magic_token: magicToken,
        start_date: startDate,
        num_days: numDays,
        timezone,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to import from Google Calendar');
    }
    return res.json(); // { slot_ids, count }
  },

  // Phase 81 Plan 03 (CHKIN-06) — pre-fill the grid from the magic-token
  // user's saved availability (recurring patterns + specific overrides,
  // override-beats-recurring). Returns { slot_ids: ["ISO datetime", ...],
  // count }. Backend filters source:'default' so users with zero saved
  // patterns get an empty array, NOT the whole grid (research Pitfall 3).
  prefillFromSaved: async ({
    magicToken,
    startDate,
    numDays,
    timezone,
  }: {
    magicToken: string;
    startDate: string;
    numDays: number;
    timezone: string;
  }) => {
    const res = await fetch(`${PUBLIC_API_BASE_URL}/availability-prefill/saved`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magic_token: magicToken,
        start_date: startDate,
        num_days: numDays,
        timezone,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to use saved availability');
    }
    return res.json(); // { slot_ids, count }
  },
};

/**
 * API functions for Prompt Settings
 */
export const promptSettingsAPI = {
  // Get prompt settings for a group (includes schedules array)
  getGroupPromptSettings: (group_id: string) =>
    apiFetch(`/groups/${group_id}/prompt-settings`),

  // Create a new schedule
  createSchedule: (group_id: string, scheduleData: Record<string, unknown>) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules`, {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    }),

  // Update an existing schedule
  updateSchedule: (group_id: string, schedule_id: string, scheduleData: Record<string, unknown>) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}`, {
      method: 'PATCH',
      body: JSON.stringify(scheduleData),
    }),

  // Soft delete a schedule
  deleteSchedule: (group_id: string, schedule_id: string) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}`, {
      method: 'DELETE',
    }),

  // Toggle schedule active status (pause/resume)
  toggleSchedule: (group_id: string, schedule_id: string) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}/toggle`, {
      method: 'PATCH',
    }),
};

/**
 * API functions for Availability Prompts (respondent tracking, reminders)
 */
export const promptAPI = {
  // Get respondent list for a prompt
  getRespondents: (promptId: string) =>
    apiFetch(`/prompts/${promptId}/respondents`),

  // Send reminder to non-respondent (admin only)
  sendReminder: (promptId: string, userId: string) =>
    apiFetch(`/prompts/${promptId}/remind/${userId}`, {
      method: 'POST',
    }),

  // Fetch the most recent active/pending prompt for a group
  getActivePrompt: (groupId: string) =>
    apiFetch(`/groups/${groupId}/prompts/active`),

  // Fetch a specific prompt by ID regardless of status (used for closed prompts from email links)
  getPromptById: (promptId: string) =>
    apiFetch(`/prompts/${promptId}`),

  // Fetch heatmap suggestions for a prompt
  getSuggestions: (promptId: string) =>
    apiFetch(`/prompts/${promptId}/suggestions`),

  // Phase 71.2 / D-UI-02 — list ALL open prompts for a group (manual + auto)
  // with Creator info, GroupPromptSettings.template_name (for "From [schedule name]"),
  // and a per-requester `can_close` flag derived server-side.
  getOpenPrompts: (groupId: string) =>
    apiFetch(`/groups/${groupId}/prompts/open`),

  // Phase 71.2 / D-CLOSE-05 — soft-close a poll. Backend gates to creator OR
  // group owner/admin; frontend should hide the action when can_close === false.
  closePrompt: (promptId: string) =>
    apiFetch(`/availability-prompts/${promptId}/close`, {
      method: 'PATCH',
    }),

  // Phase 71.2 / Plan 03 hotfix — fetch a heatmap shape derived ONLY from this
  // prompt's submitted responses (not group-wide availability). Used by the
  // createEvent modal when arriving via the close-notification CTA so the
  // visual time picker shows poll results instead of standard availability.
  getPromptHeatmap: (promptId: string) =>
    apiFetch(`/prompts/${promptId}/heatmap`),
};

/**
 * API functions for Availability Suggestions (event creation from suggestions)
 */
export const suggestionAPI = {
  /**
   * Convert a suggestion to an event
   * @param {string} suggestionId - UUID of the suggestion
   * @returns {Promise<{success: boolean, event_id: string}>}
   */
  convert: (suggestionId: string) =>
    apiFetch(`/suggestions/${suggestionId}/convert`, {
      method: 'POST',
    }),
};

/**
 * API functions for Group Invites
 */
export const invitesAPI = {
  // Send a group invite by email (typed-email flow)
  sendInvite: (group_id: string, email: string) =>
    apiFetch('/invites/send', {
      method: 'POST',
      body: JSON.stringify({ group_id, email }),
    }),

  // Send a group invite to an existing friend by user_id. The friend's email is
  // resolved server-side (behind an accepted-friendship gate) — the client never
  // handles friend emails (preserves Phase 83-06 PII default-deny).
  sendFriendInvite: (group_id: string, friend_user_id: string) =>
    apiFetch('/invites/send', {
      method: 'POST',
      body: JSON.stringify({ group_id, friend_user_id }),
    }),

  // Invite a guest who played in one of the group's events to join the group.
  // `participant_user_id` is a User.id UUID (EventParticipation.user_id). Email is
  // resolved server-side, bound to the group's event participants and gated on the
  // caller being owner/admin (preserves Phase 83-06 PII default-deny). [83.3 SEAM-01]
  sendParticipantInvite: (group_id: string, participant_user_id: string) =>
    apiFetch('/invites/send', {
      method: 'POST',
      body: JSON.stringify({ group_id, participant_user_id }),
    }),

  // Get current user's pending invites
  getPendingInvites: () =>
    apiFetch('/invites/pending'),

  // Accept a pending invite by invite ID
  acceptInvite: (invite_id: string) =>
    apiFetch(`/invites/${invite_id}/accept`, { method: 'POST' }),

  // Decline a pending invite by invite ID
  declineInvite: (invite_id: string) =>
    apiFetch(`/invites/${invite_id}/decline`, { method: 'POST' }),

  // Accept invite by token (from email link)
  acceptInviteByToken: (token: string) =>
    apiFetch('/invites/accept-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get pending invites for a group (admin view)
  getGroupPendingInvites: (group_id: string) =>
    apiFetch(`/invites/group/${group_id}/pending`),

  // Get invite info by token (public, no auth required) — consumed LOGGED-OUT on
  // invite/accept/page.js, so it MUST bypass the BFF proxy (direct-to-backend).
  getInviteInfo: (token: string) =>
    publicFetch(`/invites/info/${token}`),
};

/**
 * API functions for Friendships (Social Graph)
 */
export const friendshipsAPI = {
  // Get accepted friends for current user
  getFriends: () =>
    apiFetch('/friendships?status=accepted'),

  // Get received pending friend requests
  getReceivedRequests: () =>
    apiFetch('/friendships?status=pending&direction=received'),

  // Get sent pending friend requests
  getSentRequests: () =>
    apiFetch('/friendships?status=pending&direction=sent'),

  // Search for a user by exact email (local DB only, no auto-create)
  searchUserByEmail: (email: string) =>
    apiFetch(`/friendships/search?email=${encodeURIComponent(email)}`),

  // Send a friend request by user_id
  sendRequest: (addressee_user_id: string) =>
    apiFetch('/friendships/request', {
      method: 'POST',
      body: JSON.stringify({ addressee_user_id }),
    }),

  // Accept a pending friend request
  acceptRequest: (friendship_id: string) =>
    apiFetch(`/friendships/${friendship_id}/accept`, { method: 'POST' }),

  // Decline a pending friend request
  declineRequest: (friendship_id: string) =>
    apiFetch(`/friendships/${friendship_id}/decline`, { method: 'POST' }),

  // Remove a friend (unfriend - hard delete)
  removeFriend: (friendship_id: string) =>
    apiFetch(`/friendships/${friendship_id}`, { method: 'DELETE' }),
};

/**
 * API functions for Game Suggestions (smart game recommendations)
 */
interface SuggestionParams {
  playerCount?: string;
  maxPlayTime?: string;
  minWeight?: string;
  maxWeight?: string;
  sort?: string;
}

export const suggestionsAPI = {
  // Get suggestions for a specific event (uses RSVP player count)
  getEventSuggestions: (eventId: string, params: SuggestionParams = {}) => {
    const query = new URLSearchParams();
    if (params.maxPlayTime) query.set('maxPlayTime', params.maxPlayTime);
    if (params.minWeight) query.set('minWeight', params.minWeight);
    if (params.maxWeight) query.set('maxWeight', params.maxWeight);
    if (params.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return apiFetch(`/suggestions/event/${eventId}${qs ? '?' + qs : ''}`);
  },
  // Get suggestions for a group (requires playerCount)
  getGroupSuggestions: (groupId: string, params: SuggestionParams = {}) => {
    const query = new URLSearchParams();
    if (params.playerCount) query.set('playerCount', params.playerCount);
    if (params.maxPlayTime) query.set('maxPlayTime', params.maxPlayTime);
    if (params.minWeight) query.set('minWeight', params.minWeight);
    if (params.maxWeight) query.set('maxWeight', params.maxWeight);
    if (params.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return apiFetch(`/suggestions/group/${groupId}${qs ? '?' + qs : ''}`);
  },
};

/**
 * API functions for Game Voting Ballots
 */
export const ballotAPI = {
  // Get ballot for an event (options, vote state, winner)
  getBallot: (eventId: string) =>
    apiFetch<Ballot>(`/ballot/${eventId}`),

  // Create/set ballot options (organizer only, requires rsvp_deadline on event)
  setBallotOptions: (eventId: string, options: unknown[]) =>
    apiFetch(`/ballot/${eventId}/options`, {
      method: 'POST',
      body: JSON.stringify({ options }),
    }),

  // Update ballot options (organizer only, before close)
  updateBallotOptions: (eventId: string, options: unknown[]) =>
    apiFetch(`/ballot/${eventId}/options`, {
      method: 'PUT',
      body: JSON.stringify({ options }),
    }),

  // Toggle vote on an option (approval voting: add or remove)
  toggleVote: (eventId: string, optionId: string) =>
    apiFetch(`/ballot/${eventId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    }),

  // Resolve a tie or no-vote scenario (organizer picks winner)
  resolveTie: (eventId: string, optionId: string) =>
    apiFetch(`/ballot/${eventId}/resolve-tie`, {
      method: 'POST',
      body: JSON.stringify({ option_id: optionId }),
    }),
};

