import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Card, Chip, Stack, Typography } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import type { Car } from '@carlog/contracts';
import { useReminders } from '../queries';
import { reminderStatus, todayISO } from '../lib/reminder-view';

type Counts = { overdue: number; dueSoon: number };

// Subscribes to one car's reminders and reports its due/overdue tallies upward.
// Renders nothing itself — the parent draws the aggregated strip. Kept as a
// component (not a loop of hooks) so each car's useReminders subscription is
// stable across renders.
function AttentionProbe({ car, onReport }: { car: Car; onReport: (id: string, c: Counts) => void }) {
  const { data: reminders } = useReminders(car.id);
  useEffect(() => {
    if (!reminders) return;
    const today = todayISO();
    const statuses = reminders.map((r) => reminderStatus(r, car.mileage, today));
    onReport(car.id, {
      overdue: statuses.filter((s) => s === 'overdue').length,
      dueSoon: statuses.filter((s) => s === 'due_soon').length,
    });
  }, [reminders, car.id, car.mileage, onReport]);
  return null;
}

// A compact "what needs doing anywhere in the garage" summary above the car grid.
// For a multi-car owner this answers a question no single vehicle card can. Each
// row jumps straight to that car's reminders tab. Renders nothing when nothing is due.
export function GarageAttention({ cars }: { cars: Car[] }) {
  const { t } = useTranslation(['garage', 'reminders']);
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Record<string, Counts>>({});

  const report = useCallback((id: string, c: Counts) => {
    setCounts((prev) => {
      const cur = prev[id];
      if (cur && cur.overdue === c.overdue && cur.dueSoon === c.dueSoon) return prev;
      return { ...prev, [id]: c };
    });
  }, []);

  const rows = cars
    .map((car) => ({ car, c: counts[car.id] }))
    .filter((x): x is { car: Car; c: Counts } => x.c !== undefined && x.c.overdue + x.c.dueSoon > 0)
    .sort((a, b) => b.c.overdue - a.c.overdue || b.c.dueSoon - a.c.dueSoon);

  return (
    <>
      {cars.map((car) => <AttentionProbe key={car.id} car={car} onReport={report} />)}
      {rows.length ? (
        <Card sx={{ mb: 3, p: { xs: 2, sm: 2.5 } }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <NotificationsActiveIcon fontSize="small" color="warning" />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('garage:attentionTitle')}</Typography>
          </Stack>
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
            {rows.map(({ car, c }) => {
              const title = car.nickname || `${car.make} ${car.model}`;
              return (
                <Stack
                  key={car.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                  onClick={() => navigate(`/cars/${car.id}?tab=reminders`)}
                  sx={{
                    py: 1,
                    cursor: 'pointer',
                    borderRadius: 1,
                    px: 1,
                    mx: -1,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{title}</Typography>
                  <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
                    {c.overdue > 0 ? (
                      <Chip size="small" color="error" label={c.overdue} aria-label={t('reminders:badgeOverdue')} />
                    ) : null}
                    {c.dueSoon > 0 ? (
                      <Chip size="small" color="warning" label={c.dueSoon} aria-label={t('reminders:badgeDueSoon')} />
                    ) : null}
                  </Stack>
                </Stack>
              );
            })}
          </Stack>
        </Card>
      ) : null}
    </>
  );
}