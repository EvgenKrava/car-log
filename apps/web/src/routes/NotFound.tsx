import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { StatusCard } from '../components/StatusCard';
import { GARAGE_PATH } from '../lib/paths';

export function NotFound() {
  const { t } = useTranslation(['common']);
  const navigate = useNavigate();
  return (
    <StatusCard title={t('common:notFoundTitle')} body={t('common:notFoundBody')}
      primaryLabel={t('common:backToGarage')} onPrimary={() => navigate(GARAGE_PATH)} />
  );
}
