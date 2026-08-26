'use client';

/**
 * FormField — shared label + control + error wrapper (PRIM-06 / D-10, UI-SPEC §Form-field UX).
 *
 * Centralizes ONE label/error/aria treatment without imposing layout:
 *   - Label: 14px/400, emphasis carried by COLOUR (`text-content-primary`), not weight
 *     — see the DECISION marker below. `htmlFor` wired to the control id.
 *   - Error: 12px/400 (`text-xs`), `--color-error` (`text-status-error`), `role="alert"`,
 *     wired to the control via `aria-describedby` only when present.
 *   - Invalid control: `aria-invalid="true"` when errored.
 *   - Layout: NONE imposed — the wrapper is a plain `<div>` taking the consumer's
 *     `className`; ScheduleForm/AvailabilityForm keep their own grids.
 *
 * The single child control is cloned to inject `id`/`aria-invalid`/`aria-describedby`,
 * so consumers keep `{...register(...)}` (or any control markup) untouched.
 */
import * as React from 'react';

/* DECISION Phase 88-03 (UI-SPEC §4.2): the default label renders at 14px/**400** with
   `text-content-primary` carrying the emphasis. Chosen OVER the 14px/**600** (a semibold
   weight utility + `text-content-secondary`) this shipped with, and over the narrower fix a
   reader would reach for first — keeping 600 here and maintaining a per-call-site exception
   list of the forms allowed to differ.

   WHY 600 LOSES: the design reference states it as a prohibition, not a preference —
   "Default pairing: 700 headings + 400 body. Never 600/400 — too subtle to register as
   hierarchy" — and D-01 gives 600 exactly ONE home, the `Button` primitive. A shared field
   wrapper is not that home. Emphasis at 14px is carried by COLOUR
   (`content-primary` against `content-secondary`), which is why the colour token moves in the
   same edit; dropping the weight alone would have made labels quieter, not equal.

   WHY THE EXCEPTION LIST LOSES: it re-scatters the decision this wrapper exists to centralize,
   and a list nobody can see from the call site is a list that drifts.

   THIS IS A NAMED TRADE-OFF, NOT A SILENT EDIT: it changes label rendering in every form that
   uses this wrapper, and it is the default every future adopter inherits. MEASURED BLAST
   RADIUS AT THE TIME OF THE EDIT (2026-08-04): one production consumer, `ScheduleForm.js`
   (8 fields, :214-:365), plus `SelectField.tsx`, which has no production consumer yet — so the
   change is preventative, taken here precisely BEFORE the Req 1 adoption pass multiplies it.
   `labelClassName` stays overridable for a genuine one-off. `FormField.test.tsx`
   pins the absence of a semibold utility so a later phase cannot quietly restore 600 here. */
export interface FormFieldProps {
  /** Visible label text (14px/400), wired to the control via htmlFor/id. */
  label: string;
  /** Inline error message; when present renders a role="alert" node + flags the control invalid. */
  error?: string;
  /** Explicit control id; defaults to the child's own id, else an auto-generated id. */
  htmlFor?: string;
  /** Optional helper/hint content rendered between the control and the error. */
  hint?: React.ReactNode;
  /** Appends the existing required marker convention (an asterisk) to the label. */
  required?: boolean;
  /** Wrapper className — consumers own the layout (e.g. `mb-4`). */
  className?: string;
  /** Override the default label classes if a consumer needs to. */
  labelClassName?: string;
  /** Exactly one control element (input/select/textarea or a forwarding component). */
  children: React.ReactElement;
}

export function FormField({
  label,
  error,
  htmlFor,
  hint,
  required,
  className,
  labelClassName,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const childProps = children.props as {
    id?: string;
    'aria-describedby'?: string;
  };
  const controlId = htmlFor ?? childProps.id ?? generatedId;
  const errorId = `${controlId}-error`;

  const describedBy =
    [childProps['aria-describedby'], error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const control = React.cloneElement(children, {
    id: controlId,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
  } as Partial<typeof childProps> & {
    'aria-invalid'?: 'true';
  });

  return (
    <div className={className}>
      <label
        htmlFor={controlId}
        className={labelClassName ?? 'block text-sm font-normal text-content-primary mb-1'}
      >
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint}
      {error && (
        <p id={errorId} role="alert" className="text-content-status-error text-xs mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
