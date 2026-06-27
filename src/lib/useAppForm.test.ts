import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { z } from 'zod';
import { useAppForm } from './useAppForm';
import { logger } from './logger';

// The Sentry submit-error log path runs through logger.error; mock it so we can
// assert it fires on a throwing onValid (the previously-dead path this plan
// resolves) without touching real Sentry.
vi.mock('./logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const schema = z.object({ name: z.string().min(1, 'Name is required') });

describe('useAppForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the rhf API including formState.isSubmitting and handleAppSubmit', () => {
    const { result } = renderHook(() => useAppForm(schema));
    expect(typeof result.current.handleSubmit).toBe('function');
    expect(typeof result.current.handleAppSubmit).toBe('function');
    expect(typeof result.current.register).toBe('function');
    expect(typeof result.current.control).toBe('object');
    expect(result.current.formState.isSubmitting).toBe(false);
  });

  it('valid values pass zodResolver and reach onValid (no error logged)', async () => {
    const onValid = vi.fn();
    const { result } = renderHook(() =>
      useAppForm(schema, { defaultValues: { name: 'ok' } })
    );
    await act(async () => {
      await result.current.handleAppSubmit(onValid)();
    });
    expect(onValid.mock.calls[0][0]).toEqual({ name: 'ok' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('invalid values surface formState.errors and never reach onValid', async () => {
    const onValid = vi.fn();
    const { result } = renderHook(() =>
      useAppForm(schema, { defaultValues: { name: '' } })
    );
    await act(async () => {
      await result.current.handleAppSubmit(onValid)();
    });
    expect(onValid).not.toHaveBeenCalled();
    expect(result.current.formState.errors.name?.message).toBe('Name is required');
  });

  it('a throwing onValid routes to logger.error AND is swallowed (no re-throw escapes)', async () => {
    const boom = new Error('submit failed');
    const onValid = vi.fn().mockRejectedValue(boom);
    const { result } = renderHook(() =>
      useAppForm(schema, { defaultValues: { name: 'ok' } })
    );
    let threw = false;
    await act(async () => {
      try {
        await result.current.handleAppSubmit(onValid)();
      } catch {
        threw = true;
      }
    });
    expect(onValid).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('form submit failed', boom);
    expect(threw).toBe(false);
  });
});
