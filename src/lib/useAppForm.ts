/**
 * useAppForm(schema) — the shared react-hook-form + Zod form primitive (PRIM-06 / D-10).
 *
 * Wraps `useForm` + `zodResolver(schema)` so consumers stop hand-rolling the
 * resolver wiring, and adds `handleAppSubmit(onValid)`: a submit wrapper that
 * runs `handleSubmit`, and on a thrown error in `onValid` routes it to
 * `logger.error('form submit failed', err)` (→ Sentry) and then SWALLOWS it —
 * no unhandled re-throw escapes `handleAppSubmit`, so there is no unhandled
 * rejection.
 *
 * For the Sentry log path to fire, each consumer's `onValid` keeps its own
 * try/catch that sets the component's inline submit-error UI state on failure
 * AND THEN RE-THROWS, so the error reaches this catch and is logged. (Resolves
 * the previously-dead logger path where consumers swallowed the error in
 * `onValid` and `handleAppSubmit`'s catch never saw it.)
 *
 * Info-Disclosure threat T-84-01: only a fixed message + the error object reach
 * `logger.error`; no raw form-field values (potential PII) are spread into the
 * Sentry payload here.
 */
import {
  useForm,
  type UseFormProps,
  type UseFormReturn,
  type FieldValues,
  type SubmitHandler,
  type Resolver,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodType } from 'zod';
import { logger } from '@/lib/logger';

export interface UseAppFormReturn<T extends FieldValues> extends UseFormReturn<T> {
  /**
   * Submit wrapper around `handleSubmit`. A thrown error in `onValid` is routed
   * to `logger.error` and then swallowed (no re-throw escapes this wrapper).
   * Consumers re-throw from `onValid` after setting their inline error state so
   * this catch is reached.
   */
  handleAppSubmit: (onValid: SubmitHandler<T>) => ReturnType<UseFormReturn<T>['handleSubmit']>;
}

export function useAppForm<T extends FieldValues>(
  schema: ZodType<T>,
  options?: Omit<UseFormProps<T>, 'resolver'>,
): UseAppFormReturn<T> {
  const form = useForm<T>({
    // zod v4's input/output generic variance does not flow through a generic
    // `ZodType<T>` into zodResolver's overloads (the schema's `_input` is
    // `unknown`, which the overloads reject). This contained cast bridges that
    // known generic-wrapper typing limitation; the runtime resolver is correct.
    resolver: zodResolver(schema as never) as Resolver<T>,
    ...options,
  });

  const handleAppSubmit: UseAppFormReturn<T>['handleAppSubmit'] = (onValid) =>
    form.handleSubmit(async (values, event) => {
      try {
        await onValid(values, event);
      } catch (err) {
        // Route to Sentry, then swallow — no unhandled re-throw escapes here.
        logger.error('form submit failed', err);
      }
    });

  return { ...form, handleAppSubmit };
}
