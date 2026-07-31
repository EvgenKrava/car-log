import { forwardRef, useImperativeHandle, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Car, CreateEventInput, Reminder } from '@carlog/contracts';
import { useDeleteReminder, useReminders } from '../queries';
import { sortReminders, todayISO } from '../lib/reminder-view';
import { ReminderCard } from './ReminderCard';
import { ReminderFormDialog } from './ReminderFormDialog';
import { CompleteReminderDialog } from './CompleteReminderDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { EventFormDialog } from './EventFormDialog';
import { StatusView } from './ui/StatusView';

export type RemindersSectionHandle = { openAdd: () => void };

export const RemindersSection = forwardRef<RemindersSectionHandle, { car: Car }>(function RemindersSection({ car }, ref) {
  const { t } = useTranslation(['reminders', 'common']);
  const { data: reminders, isLoading, isError } = useReminders(car.id);
  const del = useDeleteReminder(car.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | undefined>();
  useImperativeHandle(ref, () => ({ openAdd: () => { setEditing(undefined); setFormOpen(true); } }), []);
  const [deleting, setDeleting] = useState<Reminder | undefined>();
  const [completing, setCompleting] = useState<Reminder | undefined>();
  // After a completion, offer to log the done work as a service event (skippable).
  const [eventPrefill, setEventPrefill] = useState<Partial<CreateEventInput> | undefined>();

  const sorted = sortReminders(reminders ?? [], car.mileage, todayISO());

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>{t('reminders:sectionTitle')}</Typography>
      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('reminders:loadError')} />
      ) : !sorted.length ? (
        <Typography color="text.secondary">{t('reminders:empty')}</Typography>
      ) : (
        <Box>
          {sorted.map((r) => (
            <ReminderCard key={r.id} reminder={r} car={car}
              onEdit={() => { setEditing(r); setFormOpen(true); }}
              onDelete={() => setDeleting(r)}
              onDone={() => setCompleting(r)} />
          ))}
        </Box>
      )}

      <ReminderFormDialog open={formOpen} onClose={() => setFormOpen(false)} carId={car.id}
        mode={editing ? 'edit' : 'create'} reminder={editing} />

      {deleting ? (
        <ConfirmDialog open title={t('reminders:deleteTitle')} message={t('reminders:deleteConfirm')}
          confirmLabel={t('common:delete')} loading={del.isPending}
          onConfirm={() => { del.mutate(deleting.id, { onSettled: () => setDeleting(undefined) }); }}
          onClose={() => setDeleting(undefined)} />
      ) : null}

      {completing ? (
        <CompleteReminderDialog open carId={car.id} reminder={completing} carMileage={car.mileage}
          onClose={() => setCompleting(undefined)}
          onCompleted={(prefill) => { setCompleting(undefined); setEventPrefill(prefill); }} />
      ) : null}

      <EventFormDialog open={Boolean(eventPrefill)} onClose={() => setEventPrefill(undefined)}
        carId={car.id} mode="create" initial={eventPrefill} />
    </Box>
  );
});
