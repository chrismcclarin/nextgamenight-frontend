/**
 * isUuid — the FRONTEND mirror of the backend's canonical UUID shape.
 *
 * DECISION Phase 88.6.1-07 (D-03 / AC-6 / CSPT).
 *
 * WHY IT EXISTS. `eventsAPI.getEvent` interpolates the URL id into the request path unencoded
 * (`src/lib/api.ts`, anchor `getEvent: (event_id`, the `/events/${event_id}` template). A link
 * whose id decodes to dot-segments (`..%2Fusers%2Fme`) is normalised by the browser into
 * ANOTHER same-origin BFF path before the proxy's segment check ever sees it, so the victim's
 * browser issues an authenticated GET to that path and the page renders the reply as an event
 * (88.6.1-RESEARCH.md Security Domain, the CSPT row). Validating the id where it is read, before
 * any request, closes that, and gives AC-6 its zero-request "Event not found".
 *
 * CHOSEN: a hand-written mirror of the backend's own definition
 * (`periodictabletopbackend_v2/Sonnet/utils/resolveTargetUser.js:25-26`, anchor `const UUID_RE =`),
 * so the two cannot disagree about which ids are real. The literal below is byte-equal to it:
 * anchored at both ends, the `i` flag only, NO `m` flag (with `m`, a trailing newline would slip
 * past `$`; `isUuid.test.ts` U3 pins that row).
 *
 * REJECTED (a): a UUID package. It adds a dependency for one regex the backend already defines,
 * and the phase installs no packages.
 * REJECTED (b): `encodeURIComponent` on the path segment instead of validating. It closes the
 * traversal but still issues a request for a garbage id, and AC-6 requires zero requests.
 * REJECTED (c): an inline regex at each consumer (duplication tenet).
 * REJECTED (d): a type-predicate return (`value is string`). The false branch would narrow a
 * non-UUID string to `null` for a `string | null` caller, which is a lie.
 *
 * Consumer: plan 88.6.1-25, at the event page's URL read (`src/app/gameDetail/page.js`, anchor
 * `searchParams.get('event_id')`). Pure module, no `'use client'`: safe on server and client.
 * Widening the accepted shape (braces, unhyphenated, whitespace) is a decision, not a cleanup.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}
