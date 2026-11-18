import { Alert, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { planLimitInfo, UPGRADE_URL } from '../lib/api-error';

// Shown when the server refuses an action because of the caller's plan. Free users get a
// link to Only Tools Plus; Plus users only see the limit (there is no higher plan).
export function PlanLimitAlert({ error }: { error: unknown }) {
  const { t } = useTranslation(['common']);
  const info = planLimitInfo(error);
  if (!info) return null;
  const text = t(`common:planLimit_${info.kind}`, { count: info.limit });
  return (
    <Alert
      severity="info"
      action={info.plan === 'free' ? (
        <Button color="inherit" size="small" href={UPGRADE_URL} target="_blank" rel="noopener">{t('common:planUpgrade')}</Button>
      ) : undefined}
    >
      {info.plan === 'free' ? `${text} ${t('common:planUpgradeHint')}` : text}
    </Alert>
  );
}
