import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EVENT_CATEGORIES, type CreateReminderInput, type Reminder } from '@carlog/contracts';
import { useCreateReminder, useUpdateReminder } from '../queries';
import { NumberField } from './ui/NumberField';
import { useBottomSheetDismiss } from './ui/useBottomSheetDismiss';

// Validates against the CreateReminderSchema rules but with localized messages
// (same pattern as EventFormDialog.buildFormSchema).
function buildFormSchema(t: TFunction) {
  return z.object({
    title: z.string().min(1, t('reminders:errorRequired')).max(120),
    category: z.enum(EVENT_CATEGORIES),
    notes: z.literal('').transform(() => undefined).or(z.string().max(500).optional()),
    dueDate: z.literal('').transform(() => undefined).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    dueMileage: z.number().int().min(0).optional(),
    repeatMonths: z.number().int().min(1).max(120).optional(),
    repeatKm: z.number().int().min(100).optional(),
  }).superRefine((r, ctx) => {
    if (r.dueDate === undefined && r.dueMileage === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('reminders:errorNeedTarget'), path: ['dueDate'] });
    }
    if (r.repeatMonths !== undefined && r.dueDate === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('reminders:errorRepeatNeedsDate'), path: ['repeatMonths'] });
    }
    if (r.repeatKm !== undefined && r.dueMileage === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: t('reminders:errorRepeatNeedsMileage'), path: ['repeatKm'] });
    }
  });
}

const EMPTY: CreateReminderInput = { title: '', category: 'other' };

const toForm = (r: Reminder): CreateReminderInput => ({
  title: r.title, category: r.category, notes: r.notes,
  dueDate: r.dueDate, dueMileage: r.dueMileage, repeatMonths: r.repeatMonths, repeatKm: r.repeatKm,
});

export function ReminderFormDialog({
  open, onClose, carId, mode, reminder,
}: { open: boolean; onClose: () => void; carId: string; mode: 'create' | 'edit'; reminder?: Reminder }) {
  const { t } = useTranslation(['reminders', 'event', 'common']);
  const create = useCreateReminder(carId);
  const update = useUpdateReminder(carId);
  const isPending = create.isPending || update.isPending;

  const formSchema = useMemo(() => buildFormSchema(t), [t]);
  const { control, handleSubmit, reset, formState: { errors, isSubmitted } } = useForm<CreateReminderInput>({
    resolver: zodResolver(formSchema), defaultValues: EMPTY,
  });
  const sheet = useBottomSheetDismiss(onClose);

  useEffect(() => {
    if (!open) return;
    reset(mode === 'edit' && reminder ? toForm(reminder) : EMPTY);
  }, [open, mode, reminder, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (mode === 'edit' && reminder) await update.mutateAsync({ reminderId: reminder.id, input: data });
    else await create.mutateAsync(data);
    reset(EMPTY); onClose();
  });

  const isError = create.isError || update.isError;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" {...sheet}>
      <form onSubmit={onSubmit}>
        <DialogTitle>{mode === 'edit' ? t('reminders:editTitle') : t('reminders:addTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {isError ? <Alert severity="error">{t('reminders:saveFailed')}</Alert> : null}
            {isSubmitted && Object.keys(errors).length > 0 ? (
              <Alert severity="warning">{t('reminders:errorFixFields')}</Alert>
            ) : null}
            <Controller name="title" control={control} render={({ field }) => (
              <TextField {...field} label={t('reminders:title')} fullWidth
                error={Boolean(errors.title)} helperText={errors.title?.message} />
            )} />
            <Controller name="category" control={control} render={({ field }) => (
              <TextField {...field} select label={t('reminders:category')} fullWidth>
                {EVENT_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>{t(`event:category_${c}`)}</MenuItem>
                ))}
              </TextField>
            )} />
            <Stack direction="row" spacing={2}>
              <Controller name="dueDate" control={control} render={({ field }) => (
                <TextField {...field} value={field.value ?? ''} type="date" label={t('reminders:dueDate')} fullWidth
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.dueDate)} helperText={errors.dueDate?.message} />
              )} />
              <Controller name="repeatMonths" control={control} render={({ field }) => (
                <NumberField value={field.value} onChange={field.onChange} min={1}
                  label={t('reminders:repeatMonths')} fullWidth
                  error={Boolean(errors.repeatMonths)} helperText={errors.repeatMonths?.message} />
              )} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <Controller name="dueMileage" control={control} render={({ field }) => (
                <NumberField value={field.value} onChange={field.onChange}
                  label={t('reminders:dueMileage')} fullWidth
                  error={Boolean(errors.dueMileage)} helperText={errors.dueMileage?.message} />
              )} />
              <Controller name="repeatKm" control={control} render={({ field }) => (
                <NumberField value={field.value} onChange={field.onChange} min={100}
                  label={t('reminders:repeatKm')} fullWidth
                  error={Boolean(errors.repeatKm)} helperText={errors.repeatKm?.message} />
              )} />
            </Stack>
            <Controller name="notes" control={control} render={({ field }) => (
              <TextField {...field} value={field.value ?? ''} label={t('reminders:notes')} fullWidth multiline minRows={2} />
            )} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? t('reminders:saveChanges') : t('reminders:save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}