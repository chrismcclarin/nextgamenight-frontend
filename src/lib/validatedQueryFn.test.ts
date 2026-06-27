/**
 * Unit gate for validatedQueryFn (D-12 / C-004): the parse-before-cache boundary
 * over the existing apiFetch seam.
 *   - valid response  → resolves the parsed, typed value
 *   - invalid response → rejects with a ZodError (so QueryCache.onError escalates)
 *   - apiFetch throws  → the ApiError propagates UNCHANGED (no re-implementation)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { apiFetch, ApiError } from '@/lib/api';
import { validatedQueryFn } from '@/lib/validatedQueryFn';

// Keep the real ApiError; mock only the network choke-point.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiFetch: vi.fn() };
});

const schema = z.object({ id: z.string(), name: z.string() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validatedQueryFn', () => {
  it('resolves the parsed, typed value for a valid response', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ id: 'g1', name: '6 Nimmt' });
    const result = await validatedQueryFn(schema, '/games')();
    expect(result).toEqual({ id: 'g1', name: '6 Nimmt' });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/games');
  });

  it('rejects with a ZodError when the response fails the schema', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ id: 123 }); // wrong type + missing name
    await expect(validatedQueryFn(schema, '/games')()).rejects.toBeInstanceOf(z.ZodError);
  });

  it('propagates an ApiError from apiFetch unchanged (no re-implementation)', async () => {
    const apiErr = new ApiError('forbidden', 'forbidden', 403);
    vi.mocked(apiFetch).mockRejectedValue(apiErr);
    await expect(validatedQueryFn(schema, '/games')()).rejects.toBe(apiErr);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
