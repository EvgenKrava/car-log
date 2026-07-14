const localeOf = (lng: string): string => (lng.startsWith('uk') ? 'uk-UA' : 'en-US');

export function formatNumber(value: number, lng: string): string {
  return new Intl.NumberFormat(localeOf(lng)).format(value);
}

export function formatDate(iso: string, lng: string): string {
  // Render in UTC: event dates are date-only (parsed as UTC midnight); without a fixed
  // timeZone, a browser west of UTC would show the previous calendar day.
  return new Intl.DateTimeFormat(localeOf(lng), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
}
