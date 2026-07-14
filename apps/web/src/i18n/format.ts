const localeOf = (lng: string): string => (lng.startsWith('uk') ? 'uk-UA' : 'en-US');

export function formatNumber(value: number, lng: string): string {
  return new Intl.NumberFormat(localeOf(lng)).format(value);
}

export function formatDate(iso: string, lng: string): string {
  return new Intl.DateTimeFormat(localeOf(lng), { dateStyle: 'medium' }).format(new Date(iso));
}
