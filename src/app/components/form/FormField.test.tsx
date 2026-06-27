// GAP8 a11y contract for the shared field wrappers (PRIM-06 / D-10).
//
// Both FormField (register/plain-control path) and SelectField (Controller path)
// must centralize ONE label/error treatment: an error node with role="alert",
// the control flagged aria-invalid="true", and the control's aria-describedby
// resolving to the error node's id. Asserted behaviorally, not by grep.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { FormField } from './FormField';
import { SelectField } from './SelectField';

afterEach(cleanup);

describe('FormField a11y contract', () => {
  it('errored FormField exposes role=alert error, aria-invalid, and aria-describedby wired to the error id', () => {
    render(
      <FormField label="Email" error="Email is required">
        <input type="text" />
      </FormField>
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Email is required');
    expect(alert.id).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('non-errored FormField has no alert and no aria-invalid', () => {
    render(
      <FormField label="Email">
        <input type="text" />
      </FormField>
    );
    const input = screen.getByLabelText('Email');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

function SelectHarness({ error }: { error?: string }) {
  const { control } = useForm<{ color: string }>({ defaultValues: { color: '' } });
  return (
    <SelectField
      control={control}
      name="color"
      label="Color"
      error={error}
      options={[
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ]}
    />
  );
}

describe('SelectField a11y contract', () => {
  it('errored SelectField exposes role=alert, aria-invalid, and aria-describedby on the Controller-wrapped select', () => {
    render(<SelectHarness error="Pick a color" />);
    const select = screen.getByLabelText('Color');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Pick a color');
    expect(alert.id).toBeTruthy();
    expect(select.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('non-errored SelectField has no alert and no aria-invalid', () => {
    render(<SelectHarness />);
    const select = screen.getByLabelText('Color');
    expect(select).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
