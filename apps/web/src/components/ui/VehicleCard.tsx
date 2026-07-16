import { Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { useTranslation } from 'react-i18next';
import type { Car } from '@carlog/contracts';
import { formatNumber } from '../../i18n/format';
import { useReminders } from '../../queries';
import { reminderStatus, todayISO } from '../../lib/reminder-view';

function DueBadge({ car }: { car: Car }) {
  const { data: reminders } = useReminders(car.id);
  const { t } = useTranslation(['reminders']);
  if (!reminders?.length) return null;
  const today = todayISO();
  const statuses = reminders.map((r) => reminderStatus(r, car.mileage, today));
  const overdue = statuses.filter((s) => s === 'overdue').length;
  const dueSoon = statuses.filter((s) => s === 'due_soon').length;
  if (!overdue && !dueSoon) return null;
  return (
    <Chip size="small" color={overdue ? 'error' : 'warning'} icon={<NotificationsActiveIcon />}
      label={overdue + dueSoon}
      aria-label={t(overdue ? 'reminders:badgeOverdue' : 'reminders:badgeDueSoon')} />
  );
}

export function VehicleCard({ car, onClick }: { car: Car; onClick: () => void }) {
  const { t, i18n } = useTranslation(['vehicle', 'car']);
  const title = car.nickname || `${car.make} ${car.model}`;
  return (
    // height: 100% — grid items stretch, so every card in a row matches the
    // tallest one regardless of which optional fields a car has.
    <Card sx={{ height: '100%', transition: 'box-shadow .15s, transform .15s', '&:hover': { transform: 'translateY(-2px)' } }}>
      <CardActionArea onClick={onClick} sx={{ p: 0.5, height: '100%', alignItems: 'stretch' }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="h6" noWrap>{title}</Typography>
            <Stack direction="row" spacing={0.5}>
              <DueBadge car={car} />
              <Chip label={t(`car:fuelType_${car.fuelType}`)} size="small" color="primary" variant="outlined" />
            </Stack>
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {car.year}
            {car.mileage > 0 ? ` · ${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}` : ''}
          </Typography>
          {/* Always rendered so every card has the same line count; nicknamed
              cars show make/model here, others reserve the space invisibly. */}
          <Typography variant="body2" color="text.secondary" noWrap
            sx={{ mt: 0.5, visibility: car.nickname ? 'visible' : 'hidden' }}>
            {car.nickname ? `${car.make} ${car.model}` : ' '}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}