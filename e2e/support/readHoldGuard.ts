// The runtime half of the read-only network release in e2e/support/inFlight.ts: holdRequests'
// releaseToNetwork calls this on the hold's method before anything reaches the network. A write
// handed to the network would reach the shared CI fixture, so anything but GET or HEAD throws.
//
// It lives apart from inFlight.ts, with NO imports, so plain node can load it alone and prove the
// throw (inFlight.ts imports @playwright/test and './contrast' extensionless, which node cannot
// resolve). Keep it import-free: the Phase 88.6.2-11 node probe depends on it.
export function assertReadMethod(method: string): asserts method is 'GET' | 'HEAD' {
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error(
      `releaseToNetwork refused a ${method} hold: only a GET or HEAD hold may be released to the network, because a write would reach the shared CI fixture`,
    );
  }
}
