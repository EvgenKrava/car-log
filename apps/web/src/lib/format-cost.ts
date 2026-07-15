import { formatNumber } from '../i18n/format';

// Cost 0 means "not recorded" — render nothing rather than a misleading "0 UAH".
export function formatCost(cost: number, currency: string, lang: string): string {
  if (!(cost > 0)) return '';
  return `${formatNumber(cost, lang)} ${currency}`;
}