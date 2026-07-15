import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { CreateEventSchema, EVENT_CATEGORIES, type Event, type CreateEventInput } from '@carlog/contracts';
import { useCreateEvent, useUpdateEvent } from '../queries';
import { NumberField } from './ui/NumberField';
import { useBottomSheetDismiss } from './ui/useBottomSheetDismiss';

const EMPTY: CreateEventInput = {
  date: new Date().toISOString().slice(0, 10), mileage: 0, cost: 0, currency: 'UAH', category: 'other', works: [],
};

const toForm = (e: Event): CreateEventInput => ({
  date: e.date, mileage: e.mileage, cost: e.cost, currency: e.currency, category: e.category,
  title: e.title, notes: e.notes, works: e.works,
});

export function EventFormDialog({
  open, onClose, carId, mode, event,
}: { open: boolean; onClose: () => void; carId: string; mode: 'create' | 'edit'; event?: Event }) {
  const { t } = useTranslation(['event', 'common']);
  const create = useCreateEvent(carId);
  const update = useUpdateEvent(carId);
  const isPending = create.isPending || update.isPending;

  const { control, handleSubmit, reset, formState: { errors } } = useForm<CreateEventInput>({
    resolver: zodResolver(CreateEventSchema), defaultValues: EMPTY,
  });
  const works = useFieldArray({ control, name: 'works' });
  const sheet = useBottomSheetDismiss(onClose);

  useEffect(() => {
    if (!open) return;
    reset(mode === 'edit' && event ? toForm(event) : EMPTY);
  }, [open, mode, event, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (mode === 'edit' && event) await update.mutateAsync({ eventId: event.id, input: data });
    else await create.mutateAsync(data);
    reset(EMPTY); onClose();
  });

  const isError = create.isError || update.isError;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" {...sheet}>
      <form onSubmit={onSubmit}>
        <DialogTitle>{mode === 'edit' ? t('event:editTitle') : t('event:addTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {isError ? <Alert severity="error">{t('event:saveFailed')}</Alert> : null}
            <Controller name="date" control={control} render={({ field }) => (
              <TextField {...field} type="date" label={t('event:date')} fullWidth InputLabelProps={{ shrink: true }}
                error={Boolean(errors.date)} helperText={errors.date?.message as string | undefined} />
            )} />
            <Controller name="category" control={control} render={({ field }) => (
              <TextField {...field} select label={t('event:category')} fullWidth>
                {EVENT_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{t(`event:category_${c}`)}</MenuItem>)}
              </TextField>
            )} />
            <Controller name="mileage" control={control} render={({ field }) => (
              <NumberField label={t('event:mileage')} fullWidth value={field.value}
                onChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} name={field.name}
                error={Boolean(errors.mileage)} helperText={errors.mileage?.message as string | undefined} />
            )} />
            <Controller name="cost" control={control} render={({ field }) => (
              <NumberField label={t('event:cost')} fullWidth value={field.value}
                onChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} name={field.name} />
            )} />
            <Controller name="title" control={control} render={({ field }) => (
              <TextField {...field} label={t('event:title')} fullWidth value={field.value ?? ''} />
            )} />
            <Controller name="notes" control={control} render={({ field }) => (
              <TextField {...field} label={t('event:notes')} fullWidth multiline minRows={2} value={field.value ?? ''} />
            )} />

            <Divider textAlign="left"><Typography variant="subtitle2">{t('event:works')}</Typography></Divider>
            {works.fields.map((w, wi) => (
              <Stack key={w.id} spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Controller name={`works.${wi}.description`} control={control} render={({ field }) => (
                    <TextField {...field} label={t('event:workDescription')} fullWidth size="small" />
                  )} />
                  <IconButton aria-label="remove work" onClick={() => works.remove(wi)}><DeleteIcon /></IconButton>
                </Stack>
                <PartsEditor control={control} workIndex={wi} />
              </Stack>
            ))}
            <Button onClick={() => works.append({ description: '', parts: [] })}>{t('event:addWork')}</Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? t('event:saveChanges') : t('event:save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function PartsEditor({ control, workIndex }: { control: import('react-hook-form').Control<CreateEventInput>; workIndex: number }) {
  const { t } = useTranslation(['event']);
  const parts = useFieldArray({ control, name: `works.${workIndex}.parts` });
  const text = (pi: number, field: 'name' | 'brand' | 'partNumber' | 'notes' | 'purchaseLink', label: string) => (
    <Controller name={`works.${workIndex}.parts.${pi}.${field}`} control={control} render={({ field: f }) => (
      <TextField {...f} label={label} size="small" fullWidth value={f.value ?? ''} />
    )} />
  );
  return (
    <Stack spacing={1.5} sx={{ pl: 1 }}>
      {parts.fields.map((p, pi) => (
        <Stack key={p.id} spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {text(pi, 'name', t('event:partName'))}
            <Controller name={`works.${workIndex}.parts.${pi}.quantity`} control={control} render={({ field }) => (
              <NumberField label={t('event:quantity')} size="small" sx={{ width: 90 }} min={1}
                value={field.value} onChange={(v) => field.onChange(v ?? 1)} onBlur={field.onBlur} name={field.name} />
            )} />
            <IconButton aria-label="remove part" size="small" onClick={() => parts.remove(pi)}><DeleteIcon fontSize="small" /></IconButton>
          </Stack>
          <Stack direction="row" spacing={1}>
            {text(pi, 'brand', t('event:brand'))}
            {text(pi, 'partNumber', t('event:partNumber'))}
          </Stack>
          {text(pi, 'purchaseLink', t('event:purchaseLink'))}
          {text(pi, 'notes', t('event:partNotes'))}
        </Stack>
      ))}
      <Button size="small" onClick={() => parts.append({ name: '', quantity: 1 })}>{t('event:addPart')}</Button>
    </Stack>
  );
}
