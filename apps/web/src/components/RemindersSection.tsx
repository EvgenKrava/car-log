import { forwardRef, useImperativeHandle, useState } from 'react';
import { Box, Button, Collapse, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';
import type { Car, CreateEventInput, Reminder } from '@carlog/contracts';
import { useDeleteReminder, useReminders } from '../queries';
import { groupReminders, todayISO } from '../lib/reminder-view';
import { tokens } from '../theme/tokens';
import { ReminderCard } from './ReminderCard';
import { ReminderFormDialog } from './ReminderFormDialog';
import { CompleteReminderDialog } from './CompleteReminderDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { EventFormDialog } from './EventFormDialog';
import { StatusView } from './ui/StatusView';
import { EmptyState } from './ui/EmptyState';
import { Reveal } from './ui/Reveal';

export type RemindersSectionHandle = { openAdd: () => void };

export const RemindersSection = forwardRef<RemindersSectionHandle, { car: Car }>(function RemindersSection({ car }, ref) {
  const { t } = useTranslation(['reminders', 'common']);
  const { data: reminders, isLoading, isError } = useReminders(car.id);
  const del = useDeleteReminder(car.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | undefined>();
  const openCreate = () => { setEditing(undefined); setFormOpen(true); };
  useImperativeHandle(ref, () => ({ openAdd: openCreate }), []);
  const [deleting, setDeleting] = useState<Reminder | undefined>();
  const [completing, setCompleting] = useState<Reminder | undefined>();
  // After a completion, offer to log the done work as a service event (skippable).
  const [eventPrefill, setEventPrefill] = useState<Partial<CreateEventInput> | undefined>();
  // Ids mid-removal (complete or delete): kept out of view via Collapse while the
  // exit animation plays, then dropped once the underlying mutation has settled.
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  const groups = groupReminders(reminders ?? [], car.mileage, todayISO());
  const sections = [
    { key: 'overdue', title: t('reminders:groupOverdue'), items: groups.overdue },
    { key: 'dueSoon', title: t('reminders:groupDueSoon'), items: groups.dueSoon },
    { key: 'later', title: t('reminders:groupLater'), items: groups.later },
  ].filter((s) => s.items.length > 0);

  let runningIndex = 0;

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>{t('reminders:sectionTitle')}</Typography>
      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('reminders:loadError')} />
      ) : !sections.length ? (
        <EmptyState
          title={t('reminders:emptyTitle')}
          description={t('reminders:emptyBody')}
          action={<Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('reminders:add')}</Button>}
        />
      ) : (
        <Box>
          {sections.map((section) => (
            <Box key={section.key} sx={{ mb: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {section.title}
              </Typography>
              {section.items.map((reminder) => (
                <Collapse key={reminder.id} in={!removing.has(reminder.id)}
                  timeout={tokens.motion.duration.base} unmountOnExit>
                  <Reveal index={runningIndex++}>
                    <ReminderCard reminder={reminder} car={car}
                      onEdit={() => { setEditing(reminder); setFormOpen(true); }}
                      onDelete={() => setDeleting(reminder)}
                      onDone={() => setCompleting(reminder)} />
                  </Reveal>
                </Collapse>
              ))}
            </Box>
          ))}
        </Box>
      )}

      <ReminderFormDialog open={formOpen} onClose={() => setFormOpen(false)} carId={car.id}
        mode={editing ? 'edit' : 'create'} reminder={editing} />

      {deleting ? (
        <ConfirmDialog open title={t('reminders:deleteTitle')} message={t('reminders:deleteConfirm')}
          confirmLabel={t('common:delete')} loading={del.isPending}
          onConfirm={() => {
            const id = deleting.id;
            // Close the dialog first — its backdrop would otherwise hide the card's exit
            // animation. With the list visible again, start the Collapse, and only fire
            // the mutation once it has played so the refetch it triggers doesn't reflow
            // the list mid-animation. If the delete fails, clearing `removing` in onSettled
            // simply lets the (still-present) card reappear.
            setDeleting(undefined);
            setRemoving((prev) => new Set(prev).add(id));
            setTimeout(() => {
              del.mutate(id, {
                onSettled: () => setRemoving((prev) => {
                  const next = new Set(prev);
                  next.delete(id);
                  return next;
                }),
              });
            }, tokens.motion.duration.base);
          }}
          onClose={() => setDeleting(undefined)} />
      ) : null}

      {completing ? (
        <CompleteReminderDialog open carId={car.id} reminder={completing} carMileage={car.mileage}
          onClose={() => setCompleting(undefined)}
          onCompleted={(prefill) => {
            const id = completing.id;
            setCompleting(undefined);
            // The dialog already ran the mutation (and its onSuccess invalidation) before
            // calling us, so we can only collapse AFTER the fact here — see report for why.
            setRemoving((prev) => new Set(prev).add(id));
            setTimeout(() => setRemoving((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            }), tokens.motion.duration.base);
            setEventPrefill(prefill);
          }} />
      ) : null}

      <EventFormDialog open={Boolean(eventPrefill)} onClose={() => setEventPrefill(undefined)}
        carId={car.id} mode="create" initial={eventPrefill} />
    </Box>
  );
});
