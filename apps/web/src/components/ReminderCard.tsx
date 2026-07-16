import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useTranslation } from 'react-i18next';
import type { Car, Reminder } from '@carlog/contracts';
import { formatDate, formatNumber } from '../i18n/format';
import { daysUntil, reminderStatus, todayISO } from '../lib/reminder-view';

export function ReminderCard({
  reminder, car, onEdit, onDelete, onDone,
}: { reminder: Reminder; car: Car; onEdit: () => void; onDelete: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation(['reminders', 'event', 'common']);
  const today = todayISO();
  const status = reminderStatus(reminder, car.mileage, today);
  const chipColor = status === 'overdue' ? 'error' as const : status === 'due_soon' ? 'warning' as const : 'default' as const;

  const dateLabel = reminder.dueDate !== undefined ? (() => {
    const d = daysUntil(today, reminder.dueDate);
    const rel = d > 0 ? t('reminders:dueInDays', { count: d })
      : d === 0 ? t('reminders:dueToday')
      : t('reminders:overdueDays', { count: -d });
    return `${formatDate(`${reminder.dueDate}T00:00:00.000Z`, i18n.language)} · ${rel}`;
  })() : null;

  const kmLabel = reminder.dueMileage !== undefined ? (() => {
    const left = reminder.dueMileage - car.mileage;
    return left > 0
      ? `${formatNumber(reminder.dueMileage, i18n.language)} · ${t('reminders:dueInKm', { count: left })}`
      : `${formatNumber(reminder.dueMileage, i18n.language)} · ${t('reminders:overdueKm', { count: -left })}`;
  })() : null;

  return (
    <Card variant="outlined" sx={{ mb: 1, borderRadius: 2 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Chip label={t(`event:category_${reminder.category}`)} size="small" color="primary" variant="outlined" sx={{ minWidth: 96 }} />
          <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{reminder.title}</Typography>
          {reminder.repeatMonths !== undefined || reminder.repeatKm !== undefined ? (
            <Chip icon={<RepeatIcon />} label={t('reminders:repeats')} size="small" variant="outlined" />
          ) : null}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {dateLabel ? <Chip label={dateLabel} size="small" color={chipColor} /> : null}
          {kmLabel ? <Chip label={kmLabel} size="small" color={chipColor} /> : null}
        </Stack>
        {reminder.notes ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{reminder.notes}</Typography>
        ) : null}
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button size="small" startIcon={<CheckCircleOutlineIcon />} onClick={onDone}>{t('reminders:done')}</Button>
          <Button size="small" startIcon={<EditIcon />} onClick={onEdit}>{t('common:edit')}</Button>
          <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={onDelete}>{t('common:delete')}</Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
