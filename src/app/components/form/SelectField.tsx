'use client';

/**
 * SelectField — Controller-wrapped <select> sharing FormField's label/error/aria
 * contract (PRIM-06 / D-10). Mirrors the same 14/600 label + 12/400 role="alert"
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

const DEFAULT_SELECT_CLASS =
  'w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring';

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
