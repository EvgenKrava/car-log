import { useTranslation } from 'react-i18next';
import { quotaErrorInfo } from './api-error';

// Returns a formatter that maps a QuotaExceeded error to its user-facing string (null
// for anything else, so callers fall through to their existing generic message).
export function useQuotaMessage(): (err: unknown) => string | null {
  const { t, i18n } = useTranslation(['common']);
  return (err) => {
    const info = quotaErrorInfo(err);
    if (!info) return null;
    const time = new Date(info.resetsAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
    return t('common:quotaExceeded', { kind: t(`common:quotaKind_${info.kind}`), time });
  };
}
