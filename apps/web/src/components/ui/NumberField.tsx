import { useEffect, useState } from 'react';
import { TextField, type TextFieldProps } from '@mui/material';

type NumberFieldProps = Omit<TextFieldProps, 'type' | 'value' | 'onChange'> & {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** Minimum allowed value (default 0 — positive only). */
  min?: number;
};

// A numeric text field that: accepts only values >= min (positive by default), can be
// cleared (emits `undefined`), and hides the native up/down spinner arrows.
//
// It holds its own display string so the user can freely clear the field even when the
// parent maps an empty value back to a number (e.g. `onChange={(v) => set(v ?? 0)}`).
// Without this buffer, clearing a "0" would immediately re-render "0" and the field could
// never be emptied to type a fresh value. The buffer re-syncs only when the parent's
// numeric value changes to something the current text doesn't already represent.
export function NumberField({ value, onChange, min = 0, sx, ...rest }: NumberFieldProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value));

  useEffect(() => {
    // Resync from the prop only on a genuine external change — not while the user is
    // mid-edit (when the current text already parses to the same number, or the field is
    // intentionally blank and the prop is undefined). Reading the buffer via the functional
    // setter keeps `text` out of the deps so a keystroke doesn't re-trigger this.
    setText((current) => {
      const parsed = current === '' ? undefined : Number(current);
      return parsed === value ? current : (value === undefined ? '' : String(value));
    });
  }, [value]);

  return (
    <TextField
      {...rest}
      type="number"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') { setText(''); onChange(undefined); return; }
        const n = Number(raw);
        if (Number.isNaN(n) || n < min) return; // reject negatives / non-numbers
        setText(raw);
        onChange(n);
      }}
      inputProps={{ min, inputMode: 'numeric', ...rest.inputProps }}
      sx={{
        // Remove the spinner arrows (Chrome/Safari + Firefox).
        '& input[type=number]': { MozAppearance: 'textfield' },
        '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
          WebkitAppearance: 'none', margin: 0,
        },
        ...sx,
      }}
    />
  );
}
