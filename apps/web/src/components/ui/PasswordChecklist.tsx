import { Box, Typography } from '@mui/material';
import { CheckCircle, Circle } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { checkPassword } from '../../lib/password-policy';

// The live Cognito-policy checklist shown under a new-password field. Extracted from
// SignUp so the change-password dialog renders the identical affordance.
export function PasswordChecklist({ password }: { password: string }) {
  const { t } = useTranslation(['auth']);
  const pwCheck = checkPassword(password);
  const rows: { met: boolean; key: string }[] = [
    { met: pwCheck.minLength, key: 'auth:pwMinLength' },
    { met: pwCheck.upper, key: 'auth:pwUpper' },
    { met: pwCheck.lower, key: 'auth:pwLower' },
    { met: pwCheck.number, key: 'auth:pwNumber' },
    { met: pwCheck.symbol, key: 'auth:pwSymbol' },
  ];
  return (
    <Box sx={{ pl: 1 }}>
      <Typography variant="caption" color="text.secondary">{t('auth:pwRequirements')}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 3, fontSize: '0.75rem', color: 'text.secondary' }}>
        {rows.map((r) => (
          <li key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {r.met ? <CheckCircle fontSize="inherit" color="success" /> : <Circle fontSize="inherit" />}
            <span>{t(r.key)}</span>
          </li>
        ))}
      </Box>
    </Box>
  );
}