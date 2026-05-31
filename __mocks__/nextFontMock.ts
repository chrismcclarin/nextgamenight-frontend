// Stub for `next/font/google` under Vitest (82-RESEARCH.md Pitfall 4).
// Next's font loader runs a build-time transform that throws when imported in a
// plain jsdom test. Any font factory (Plus_Jakarta_Sans, Inter, ...) called here
// returns the inert shape components destructure: { className, variable, style }.
// Unused until a real component importing next/font is unit-tested in a later
// phase, but wired now so those tests don't break on day one.
const fontStub = () => ({
  className: '',
  variable: '',
  style: { fontFamily: '' },
});

export const Plus_Jakarta_Sans = fontStub;
export const Inter = fontStub;

// Default export catches any other named font factory via a Proxy.
export default new Proxy(
  {},
  {
    get: () => fontStub,
  }
);
