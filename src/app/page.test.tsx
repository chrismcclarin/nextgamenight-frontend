// Phase 88.6.1 plan 15 (copy row H3, D-30) — the Home route's auth-loading line names what is
// loading, in the same words as the route's own loading boundary (`src/app/loading.tsx`), so the
// two loading moments of Home read as one.
//
// The route renders `loading.tsx`'s RouteFallback while the server segment resolves, then this
// page's own line while `useUser` is still checking the session. Before this plan the second
// moment said only "Loading...". P2 reads the boundary's label from the file itself rather than
// transcribing it, so a wording change in one place reds here instead of silently splitting.
//
// Everything the page renders past the loading branch is stubbed: this file pins the loading
// line, not the signed-in home.
import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  state: { user: undefined, error: undefined, isLoading: true } as {
    user: unknown;
    error: unknown;
    isLoading: boolean;
  },
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => auth.state,
}));
vi.mock('../lib/hooks/useSelfIdentity', () => ({
  useSelfIdentity: () => ({ selfUuid: undefined }),
}));
vi.mock('./components/createGroup', () => ({ default: () => null }));
vi.mock('./userHome/UserHomePage', () => ({ default: () => null }));
vi.mock('./components/LandingPage', () => ({ default: () => <p>landing stub</p> }));
// The page imports the global stylesheet; the test must not depend on CSS processing.
vi.mock('./globals.css', () => ({}));

import App from './page';

afterEach(() => {
  cleanup();
  auth.state = { user: undefined, error: undefined, isLoading: true };
});

describe('Home — the auth-loading line names what is loading (88.6.1-15, copy row H3)', () => {
  it('P1: while useUser is loading, the line reads exactly "Getting your groups..." and never "Loading..."', () => {
    auth.state = { user: undefined, error: undefined, isLoading: true };
    render(<App />);
    expect(screen.getByText('Getting your groups...')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('P2: the line is byte-equal to the label of the route loading boundary (src/app/loading.tsx)', () => {
    const source = fs.readFileSync(path.resolve(__dirname, 'loading.tsx'), 'utf8');
    const match = source.match(/label="([^"]*)"/);
    expect(match).not.toBeNull();
    const boundaryLabel = match![1];
    auth.state = { user: undefined, error: undefined, isLoading: true };
    render(<App />);
    const line = screen.getByText(boundaryLabel);
    expect(line.textContent).toBe(boundaryLabel);
  });

  // CONFIRM-ONLY (mock wiring): green before and after the fix. It proves the auth mock
  // drives the page's branches, so P1's loading branch is reached for the right reason.
  it('P3 (confirm-only): signed out and not loading, the landing page renders', () => {
    auth.state = { user: undefined, error: undefined, isLoading: false };
    render(<App />);
    expect(screen.getByText('landing stub')).toBeInTheDocument();
  });
});
