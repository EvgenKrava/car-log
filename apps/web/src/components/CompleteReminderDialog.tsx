import { useEffect, useState } from 'react';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { CreateEventInput, Reminder } from '@carlog/contracts';
import { useCompleteReminder } from '../queries';
import { NumberField } from './ui/NumberField';
import { Modal } from './ui/Modal';
import { todayISO } from '../lib/reminder-view';

// Completing reschedules (or removes) the reminder server-side, then offers to log
// the work as a service event: onCompleted receives an EventFormDialog prefill.
// Skipping the event afterwards does NOT undo the completion (per spec).
export function CompleteReminderDialog({
  open, onClose, carId, reminder, carMileage, onCompleted,
}: {
  open: boolean; onClose: () => void; carId: string; reminder: Reminder;
  carMileage: number; onCompleted: (prefill: Partial<CreateEventInput>) => void;
}) {
  const { t } = useTranslation(['reminders', 'common']);
  const complete = useCompleteReminder(carId);
  const [date, setDate] = useState(todayISO());
  const [mileage, setMileage] = useState<number | undefined>(carMileage);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setMileage(carMileage);
    complete.reset();
  }, [open, carMileage]);

  const onConfirm = async () => {
    const input = { date, mileage: mileage ?? 0 };
    await complete.mutateAsync({ reminderId: reminder.id, input });
    onClose();
    onCompleted({ title: reminder.title, category: reminder.category, date: input.date, mileage: input.mileage });
  };

  return (
    <Modal
      open={open}
      onClose={complete.isPending ? undefined : onClose}
      title={t('reminders:completeTitle')}
      maxWidth="xs"
      actions={
        <>
          <Button onClick={onClose} disabled={complete.isPending}>{t('common:cancel')}</Button>
          <Button onClick={() => void onConfirm()} variant="contained" disabled={complete.isPending || !date}>
            {t('reminders:complete')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ mt: 1 }}>
        {complete.isError ? <Alert severity="error">{t('reminders:completeFailed')}</Alert> : null}
        <TextField type="date" label={t('reminders:completeDate')} value={date}
          onChange={(e) => setDate(e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
        <NumberField value={mileage} onChange={setMileage} label={t('reminders:completeMileage')} fullWidth />
      </Stack>
    </Modal>
  );
}
