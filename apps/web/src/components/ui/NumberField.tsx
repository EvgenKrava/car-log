import { TextField, type TextFieldProps } from '@mui/material';

type NumberFieldProps = Omit<TextFieldProps, 'type' | 'value' | 'onChange'> & {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** Minimum allowed value (default 0 — positive only). */
  min?: number;
};

// A numeric text field that: accepts only values >= min (positive by default), lets the
// field be cleared (emits `undefined` rather than snapping to 0), and hides the native
// up/down spinner arrows. Callers decide what an empty value means (0, 1, or undefined).
export function NumberField({ value, onChange, min = 0, sx, ...rest }: NumberFieldProps) {
  return (
    <TextField
      {...rest}
      type="number"
      value={value === undefined ? '' : value}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') { onChange(undefined); return; }
        const n = Number(raw);
        if (Number.isNaN(n) || n < min) return; // reject negatives / non-numbers
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
