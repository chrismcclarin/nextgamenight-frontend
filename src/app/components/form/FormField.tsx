'use client';

/**
 * FormField — shared label + control + error wrapper (PRIM-06 / D-10, UI-SPEC §Form-field UX).
 *
 * Centralizes ONE label/error/aria treatment without imposing layout:
 *   - Label: 14px/600 (`text-sm font-semibold`), `htmlFor` wired to the control id.
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

export interface FormFieldProps {
  /** Visible label text (14px/600), wired to the control via htmlFor/id. */
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
        className={labelClassName ?? 'block text-sm font-semibold text-content-secondary mb-1'}
      >
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint}
      {error && (
        <p id={errorId} role="alert" className="text-status-error text-xs mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
