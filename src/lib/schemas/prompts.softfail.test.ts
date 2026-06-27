/**
 * GAP12 — negative-path soft-fail proof. Drives the EXACT Task-2 soft-fail
 * export (`parsePromptsSoftFail`), not a re-implementation. Reuses the captured
 * real body from the contract test as the fixture, mutating copies for the
 * corrupted / top-level-invalid cases.
 *
 * Proves:
 *   (A) ONE corrupted optional field degrades to its default while the rest of
 *       the item — including the `can_close` auth decision — stays intact, and
 *       the collection is never blanked (field-level tolerance, T-84-06/07).
 *   (B) A TOP-LEVEL-invalid body returns the empty-render fallback AND tags
 *       Sentry with the queryKey ONLY (no body/token), and NEVER throws
 *       (T-84-05) — preserving the prior empty-render behavior until PRIM-03
 *       owns fetch-error UI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { parsePromptsSoftFail, openPromptsSchema, EMPTY_OPEN_PROMPTS } from './prompts';
import { promptKeys } from '../queryKeys/promptKeys';
import { CAPTURED_OPEN_PROMPTS_BODY } from './prompts.contract.test';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const G = 'group-xyz';
const openKey = promptKeys.openPolls(G);

type CaptureCtx = { tags?: Record<string, unknown>; extra?: { zodIssues?: Array<Record<string, unknown>> } };
const ctxOf = (call: number): CaptureCtx =>
  (vi.mocked(Sentry.captureException).mock.calls[call]?.[1] ?? {}) as CaptureCtx;

beforeEach(() => vi.clearAllMocks());

describe('parsePromptsSoftFail — GAP12 negative paths', () => {
  it('Case A: a corrupted optional association degrades to null; can_close + collection survive', () => {
    const body: any = structuredClone(CAPTURED_OPEN_PROMPTS_BODY);
    body.prompts[1].Creator = 'not-an-object'; // malformed optional association

    const result = parsePromptsSoftFail(openPromptsSchema, body, openKey, EMPTY_OPEN_PROMPTS);

    expect(Array.isArray(result.prompts)).toBe(true);
    expect(result.prompts.length).toBe(2); // surface NOT blanked
    expect(result.prompts[1].Creator).toBeNull(); // offending field degraded
    expect(result.prompts[1].can_close).toBe(false); // auth decision intact
    expect(result.prompts[0].can_close).toBe(true); // auth decision intact
    expect(Sentry.captureException).not.toHaveBeenCalled(); // top-level success
  });

  it('Case A2: a corrupted GroupPromptSetting alias degrades to null; item stays usable', () => {
    const body: any = structuredClone(CAPTURED_OPEN_PROMPTS_BODY);
    body.prompts[0].GroupPromptSetting = 12345; // malformed alias

    const result = parsePromptsSoftFail(openPromptsSchema, body, openKey, EMPTY_OPEN_PROMPTS);

    expect(result.prompts[0].GroupPromptSetting).toBeNull();
    expect(result.prompts[0].can_close).toBe(true);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('Case B: prompts wrong type → empty-render fallback + queryKey-only Sentry tag, no throw', () => {
    const body = { prompts: 'not-an-array' };
    let result: ReturnType<typeof parsePromptsSoftFail<typeof EMPTY_OPEN_PROMPTS>> | undefined;

    expect(() => {
      result = parsePromptsSoftFail(openPromptsSchema, body, openKey, EMPTY_OPEN_PROMPTS);
    }).not.toThrow();

    expect(result).toEqual(EMPTY_OPEN_PROMPTS);
    expect(result?.prompts).toEqual([]);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);

    const ctx = ctxOf(0);
    // queryKey-only tag: entity/scope from the key prefix, never the body/token.
    expect(ctx.tags).toEqual({ entity: 'prompts', scope: 'open' });
    // PII-safe: the offending raw value must not leak anywhere in the capture.
    expect(JSON.stringify(ctx)).not.toContain('not-an-array');
    // extra carries ONLY {path,code} per issue.
    for (const iss of ctx.extra?.zodIssues ?? []) {
      expect(Object.keys(iss).sort()).toEqual(['code', 'path']);
    }
  });

  it('Case B2: a null body → empty-render fallback + Sentry tag, no throw', () => {
    let result: ReturnType<typeof parsePromptsSoftFail<typeof EMPTY_OPEN_PROMPTS>> | undefined;

    expect(() => {
      result = parsePromptsSoftFail(openPromptsSchema, null, openKey, EMPTY_OPEN_PROMPTS);
    }).not.toThrow();

    expect(result).toEqual(EMPTY_OPEN_PROMPTS);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(ctxOf(0).tags).toEqual({ entity: 'prompts', scope: 'open' });
  });
});
