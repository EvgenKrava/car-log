import { useState } from 'react';
import { IconButton, InputAdornment, TextField, TextFieldProps } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

type PasswordFieldProps = Pick<
  TextFieldProps,
  'label' | 'value' | 'onChange' | 'error' | 'helperText' | 'autoComplete' | 'fullWidth'
>;

export function PasswordField(props: PasswordFieldProps) {
  const { t } = useTranslation(['auth']);
  const [showPassword, setShowPassword] = useState(false);

  const toggleVisibility = () => setShowPassword((prev) => !prev);

  return (
    <TextField
      {...props}
      type={showPassword ? 'text' : 'password'}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              aria-label={showPassword ? t('auth:hidePassword') : t('auth:showPassword')}
              onClick={toggleVisibility}
              edge="end"
            >
              {showPassword ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}
