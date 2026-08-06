import { useState } from 'react';
import {
  Button, Card, CardContent, Chip, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RepeatIcon from '@mui/icons-material/Repeat';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from 'react-i18next';
import type { Car, Reminder } from '@carlog/contracts';
import { formatDate, formatNumber } from '../i18n/format';
import { anchorSource, daysUntil, reminderStatus, todayISO } from '../lib/reminder-view';

export function ReminderCard({
  reminder, car, onEdit, onDelete, onDone,
}: { reminder: Reminder; car: Car; onEdit: () => void; onDelete: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation(['reminders', 'event', 'common']);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const today = todayISO();
  const status = reminderStatus(reminder, car.mileage, today);
  const accent = status === 'overdue' ? 'error.main' : status === 'due_soon' ? 'warning.main' : undefined;

  const dateRel = reminder.dueDate !== undefined ? (() => {
    const d = daysUntil(today, reminder.dueDate);
    return d > 0 ? t('reminders:dueInDays', { count: d })
      : d === 0 ? t('reminders:dueToday')
      : t('reminders:overdueDays', { count: -d });
  })() : null;

  const dateLabel = reminder.dueDate !== undefined
    ? formatDate(`${reminder.dueDate}T00:00:00.000Z`, i18n.language)
    : null;

  const kmRel = reminder.dueMileage !== undefined ? (() => {
    const left = reminder.dueMileage - car.mileage;
    return left > 0 ? t('reminders:dueInKm', { count: left }) : t('reminders:overdueKm', { count: -left });
  })() : null;

  const kmLabel = reminder.dueMileage !== undefined
    ? formatNumber(reminder.dueMileage, i18n.language)
    : null;

  const anchorText = anchorSource(reminder, car.mileage, today) === 'km' ? kmRel : dateRel;

  return (
    <Card variant="outlined" sx={{ mb: 1, borderRadius: 2, ...(accent ? { borderLeft: 3, borderLeftColor: accent } : {}) }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Chip label={t(`event:category_${reminder.category}`)} size="small" color="primary" variant="outlined" sx={{ minWidth: 96 }} />
          <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{reminder.title}</Typography>
          {reminder.repeatMonths !== undefined || reminder.repeatKm !== undefined ? (
            <Chip icon={<RepeatIcon />} label={t('reminders:repeats')} size="small" variant="outlined" />
          ) : null}
          <IconButton size="small" aria-label={t('reminders:moreActions')} onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => { setMenuAnchor(null); onEdit(); }}>
              <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('common:edit')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); onDelete(); }} sx={{ color: 'error.main' }}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText>{t('common:delete')}</ListItemText>
            </MenuItem>
          </Menu>
        </Stack>
        {anchorText ? (
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 0.5, color: accent ?? 'text.primary' }}>
            {anchorText}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {dateLabel ? <Chip label={dateLabel} size="small" variant="outlined" /> : null}
          {kmLabel ? <Chip label={kmLabel} size="small" variant="outlined" /> : null}
        </Stack>
        {reminder.notes ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{reminder.notes}</Typography>
        ) : null}
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button variant="contained" size="small" startIcon={<CheckCircleOutlineIcon />} onClick={onDone}>
            {t('reminders:done')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
