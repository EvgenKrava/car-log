import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Chip, IconButton, Popover, Stack, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
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

// Bell in the top bar with the number of reminders due or overdue across the garage.
// Opens a list of the cars that need attention; each row jumps to that car's reminders tab.
export function NotificationBell({ cars }: { cars: Car[] }) {
  const { t } = useTranslation(['garage', 'reminders']);
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

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
  const overdue = rows.reduce((n, r) => n + r.c.overdue, 0);
  const total = rows.reduce((n, r) => n + r.c.overdue + r.c.dueSoon, 0);

  return (
    <>
      {cars.map((car) => <AttentionProbe key={car.id} car={car} onReport={report} />)}
      <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={total ? t('garage:notificationsCount', { count: total }) : t('garage:notifications')}>
        <Badge badgeContent={total} color={overdue ? 'error' : 'warning'} max={99}>
          {total ? <NotificationsActiveIcon /> : <NotificationsNoneIcon />}
        </Badge>
      </IconButton>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxWidth: 'calc(100vw - 32px)', p: 2 } } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>{t('garage:attentionTitle')}</Typography>
        {rows.length ? (
          <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
            {rows.map(({ car, c }) => {
              const title = car.nickname || `${car.make} ${car.model}`;
              return (
                <Stack key={car.id} direction="row" alignItems="center" justifyContent="space-between" spacing={1}
                  role="button" tabIndex={0}
                  onClick={() => { setAnchor(null); navigate(`/cars/${car.id}?tab=reminders`); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setAnchor(null); navigate(`/cars/${car.id}?tab=reminders`); } }}
                  sx={{ py: 1, px: 1, mx: -1, cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                  <Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }}>{title}</Typography>
                  <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
                    {c.overdue > 0 ? <Chip size="small" color="error" label={c.overdue} aria-label={t('reminders:badgeOverdue')} /> : null}
                    {c.dueSoon > 0 ? <Chip size="small" color="warning" label={c.dueSoon} aria-label={t('reminders:badgeDueSoon')} /> : null}
                  </Stack>
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Typography color="text.secondary">{t('garage:nothingDue')}</Typography>
        )}
      </Popover>
    </>
  );
}
