'use client';

/**
 * SelectField — Controller-wrapped <select> sharing FormField's label/error/aria
 * contract (PRIM-06 / D-10). Mirrors the same 14/400 label + 12/400 role="alert"
 * error + aria-invalid/aria-describedby treatment for a react-hook-form
 * `Controller`-driven select, and imposes no layout.
 */
import * as React from 'react';
import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { FormField } from './FormField';

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface SelectFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  options: SelectOption[];
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** Coerce the selected value to a number on change (matches `valueAsNumber`). */
  valueAsNumber?: boolean;
  /** Override the default select classes. */
  selectClassName?: string;
}

/* DECISION Phase 88-03 (Req 1 / UI-SPEC §8.2 + §7.2): this class is fixed AT THE SOURCE rather
   than at the call sites. It previously carried NO text-size utility at all, so every consumer
   inherited whatever ambient size its surface happened to set — below 16px that is an iOS
   focus-zoom on tap, which is the phase's red blocker. It also used a bare `focus:` ring, which
   fires on programmatic and pointer focus, not just keyboard.

   `text-base` is unconditional and takes NO breakpoint variant, for the reason spelled out in
   `@/components/ui/Input` — `md:` is the breakpoint phones sit BELOW, so a variant would apply
   the safe size to desktop and the zooming size to the only viewport that zooms.

   NOT converged onto `Input.tsx`'s exported `controlClass` (the obvious tidy-up): that would
   also change this control's border token and add a phone height floor, i.e. a visual change to
   every shipped select, which belongs to an adoption plan and not to a defect fix. Converging
   them later is a decision with a visual diff, not a cleanup. */
const DEFAULT_SELECT_CLASS =
  'w-full p-2 border border-line rounded-btn text-base text-content-primary bg-surface-input focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring';

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  error,
  hint,
  required,
  className,
  valueAsNumber,
  selectClassName,
}: SelectFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <FormField
          label={label}
          error={error}
          hint={hint}
          required={required}
          className={className}
        >
          <select
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={field.value ?? ''}
            onChange={(e) =>
              field.onChange(
                valueAsNumber ? Number(e.target.value) : e.target.value
              )
            }
            className={selectClassName ?? DEFAULT_SELECT_CLASS}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
      )}
    />
  );
}
