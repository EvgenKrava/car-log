import { useMemo } from 'react';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Event } from '@carlog/contracts';
import { formatNumber } from '../i18n/format';

// A compact spend-by-year bar chart for the vehicle hero. Single series (yearly
// spend), so a single sequential hue — the system accent — with no legend; the
// title names it. Bars are baseline-anchored with 4px rounded tops and a small
// minimum height so a low year still reads. Per-bar hover tooltip gives the exact
// figure. Uses the dominant currency only (consistent with the "Total spent" tile)
// and renders nothing below two years — a one-bar trend isn't a trend.
export function SpendSparkline({ events, lang }: { events: Event[]; lang: string }) {
  const { t } = useTranslation(['vehicle']);

  const data = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const e of events) if (e.cost > 0) byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + e.cost);
    if (!byCurrency.size) return null;
    const [currency] = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]!;

    const byYear = new Map<string, number>();
    for (const e of events) {
      if (e.cost > 0 && e.currency === currency) {
        const y = e.date.slice(0, 4);
        byYear.set(y, (byYear.get(y) ?? 0) + e.cost);
      }
    }
    const years = [...byYear.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (years.length < 2) return null;
    return { currency, years, max: Math.max(...years.map(([, v]) => v)) };
  }, [events]);

  if (!data) return null;

  return (
    <Box sx={{ mt: { xs: 2, sm: 2.5 }, pt: { xs: 1.5, sm: 2 }, borderTop: 1, borderColor: 'divider' }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, mb: 1 }}
      >
        {t('vehicle:spendByYear')}
      </Typography>
      <Stack direction="row" alignItems="flex-end" spacing={1} sx={{ height: 56 }}>
        {data.years.map(([year, value]) => (
          <Tooltip key={year} title={`${year} · ${formatNumber(Math.round(value), lang)} ${data.currency}`} arrow>
            <Stack alignItems="center" spacing={0.5} sx={{ flex: 1, minWidth: 0, cursor: 'default' }}>
              <Box sx={{ width: '100%', maxWidth: 40, height: 40, display: 'flex', alignItems: 'flex-end' }}>
                <Box
                  sx={{
                    width: '100%',
                    height: `${Math.max(8, (value / data.max) * 100)}%`,
                    bgcolor: 'primary.main',
                    borderRadius: '4px 4px 0 0',
                    transition: 'opacity .15s',
                    '&:hover': { opacity: 0.82 },
                  }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: 10, lineHeight: 1 }}>
                {year}
              </Typography>
            </Stack>
          </Tooltip>
        ))}
      </Stack>
    </Box>
  );
}