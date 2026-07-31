import { useEffect, useMemo, useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  Alert, Box, Button, Chip, Divider, IconButton, Stack, TextField, Typography, useTheme,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CreateEventSchema, EVENT_CATEGORIES, type Event, type CreateEventInput } from '@carlog/contracts';
import { useCar, useCreateEvent, useEvents, useUpdateEvent } from '../queries';
import { CATEGORY_META, categoryTint } from '../lib/event-category';
import { formatNumber } from '../i18n/format';
import { NumberField } from './ui/NumberField';
import { Modal } from './ui/Modal';

// The form validates against the shared CreateEventSchema (the API contract) but layers on
// localized messages and a future-date guard that only makes sense for user-entered events
// (imported/backdated events must still pass at the API, so this stays form-side). Nested
// works[].description and parts[].name are required by the schema — surfacing their errors
// here is the main gap this closes: previously an empty work silently blocked Save.
function buildFormSchema(t: TFunction) {
  const required = t('event:errorRequired');
  const todayISO = new Date().toISOString().slice(0, 10);
  return CreateEventSchema.extend({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, t('event:errorInvalidDate'))
      .refine((d) => d <= todayISO, t('event:errorFutureDate')),
    works: z
      .array(
        z.object({
          description: z.string().min(1, required).max(200),
          parts: z
            .array(
              z.object({
                name: z.string().min(1, required).max(80),
                brand: z.literal('').transform(() => undefined).or(z.string().max(60).optional()),
                partNumber: z.literal('').transform(() => undefined).or(z.string().max(60).optional()),
                quantity: z.number().int().min(1),
                notes: z.literal('').transform(() => undefined).or(z.string().max(500).optional()),
                purchaseLink: z.literal('').transform(() => undefined).or(z.string().url(t('event:errorInvalidLink')).max(500).optional()),
              }),
            )
            .max(30)
            .default([]),
        }),
      )
      .max(30)
      .default([]),
  });
}

const EMPTY: CreateEventInput = {
  date: new Date().toISOString().slice(0, 10), mileage: 0, cost: 0, currency: 'UAH', category: 'other', works: [],
};

const toForm = (e: Event): CreateEventInput => ({
  date: e.date, mileage: e.mileage, cost: e.cost, currency: e.currency, category: e.category,
  title: e.title, notes: e.notes, works: e.works,
});

export function EventFormDialog({
  open, onClose, carId, mode, event, initial,
}: { open: boolean; onClose: () => void; carId: string; mode: 'create' | 'edit'; event?: Event; initial?: Partial<CreateEventInput> }) {
  const { t, i18n } = useTranslation(['event', 'common']);
  const theme = useTheme();
  const create = useCreateEvent(carId);
  const update = useUpdateEvent(carId);
  const isPending = create.isPending || update.isPending;
  const { data: car } = useCar(carId);
  const { data: events } = useEvents(carId);

  // Currency follows the car's most recent event — histories rarely switch currency,
  // so the last-used value is a better default than a hardcoded 'UAH'.
  const lastCurrency = useMemo(() => {
    const latest = [...(events ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return latest?.currency ?? EMPTY.currency;
  }, [events]);
  const lastMileage = car?.mileage ?? 0;

  const formSchema = useMemo(() => buildFormSchema(t), [t]);
  const { control, handleSubmit, reset, formState: { errors, isSubmitted } } = useForm<CreateEventInput>({
    resolver: zodResolver(formSchema), defaultValues: EMPTY,
  });
  const works = useFieldArray({ control, name: 'works' });

  // A gentle, NON-blocking check: an odometer usually only goes up, so a create-mode
  // reading below the car's last-known mileage is probably a typo. Backdated/imported
  // events legitimately can be lower, so this stays a hint, never a validation error.
  const watchedMileage = useWatch({ control, name: 'mileage' });
  const mileageBelowLast =
    mode === 'create' && lastMileage > 0 && typeof watchedMileage === 'number'
    && watchedMileage > 0 && watchedMileage < lastMileage;

  // Seed values are read only at open-time (via a ref), never as effect deps — so a
  // background refetch of events/car while the dialog is open can't wipe in-progress edits.
  const seedRef = useRef({ lastMileage, lastCurrency });
  seedRef.current = { lastMileage, lastCurrency };

  useEffect(() => {
    if (!open) return;
    // Create-mode seeds mileage from the odometer and currency from history; `initial`
    // (e.g. a reminder-completion prefill) still overrides both.
    reset(
      mode === 'edit' && event
        ? toForm(event)
        : { ...EMPTY, mileage: seedRef.current.lastMileage, currency: seedRef.current.lastCurrency, ...initial },
    );
  }, [open, mode, event, initial, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (mode === 'edit' && event) await update.mutateAsync({ eventId: event.id, input: data });
    else await create.mutateAsync(data);
    reset(EMPTY); onClose();
  });

  const isError = create.isError || update.isError;

  return (
    <Modal
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={mode === 'edit' ? t('event:editTitle') : t('event:addTitle')}
      contentSx={{ pt: 1 }}
      actions={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? t('event:saveChanges') : t('event:save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ mt: 1 }}>
            {isError ? <Alert severity="error">{t('event:saveFailed')}</Alert> : null}
            {isSubmitted && Object.keys(errors).length > 0 ? (
              <Alert severity="warning">{t('event:errorFixFields')}</Alert>
            ) : null}
            <Controller name="date" control={control} render={({ field }) => (
              <TextField {...field} type="date" label={t('event:date')} fullWidth InputLabelProps={{ shrink: true }}
                error={Boolean(errors.date)} helperText={errors.date?.message as string | undefined} />
            )} />
            <Controller name="category" control={control} render={({ field }) => (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}>
                  {t('event:category')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {EVENT_CATEGORIES.map((c) => {
                    const { color, Icon } = CATEGORY_META[c];
                    const active = field.value === c;
                    return (
                      <Chip
                        key={c}
                        icon={<Icon sx={{ fontSize: 16, color: `${color} !important` }} />}
                        label={t(`event:category_${c}`)}
                        onClick={() => field.onChange(c)}
                        sx={{
                          color,
                          fontWeight: 600,
                          bgcolor: active ? categoryTint(color, theme.palette.mode) : 'transparent',
                          border: 2,
                          borderColor: active ? color : 'divider',
                        }}
                      />
                    );
                  })}
                </Box>
              </Box>
            )} />
            <Box>
              <Controller name="mileage" control={control} render={({ field }) => (
                <NumberField label={t('event:mileage')} fullWidth value={field.value}
                  onChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} name={field.name}
                  error={Boolean(errors.mileage)} helperText={errors.mileage?.message as string | undefined} />
              )} />
              {mileageBelowLast ? (
                <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }}>
                  {t('event:mileageBelowLast', { mileage: formatNumber(lastMileage, i18n.language) })}
                </Typography>
              ) : null}
            </Box>
            <Stack direction="row" spacing={1.5}>
              <Controller name="cost" control={control} render={({ field }) => (
                <NumberField label={t('event:cost')} fullWidth value={field.value}
                  onChange={(v) => field.onChange(v ?? 0)} onBlur={field.onBlur} name={field.name} />
              )} />
              <Controller name="currency" control={control} render={({ field }) => (
                <TextField {...field} label={t('event:currency')} sx={{ width: 110 }}
                  inputProps={{ maxLength: 8, style: { textTransform: 'uppercase' } }}
                  onChange={(e) => field.onChange(e.target.value.toUpperCase())} />
              )} />
            </Stack>
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
                    <TextField {...field} label={t('event:workDescription')} fullWidth size="small"
                      error={Boolean(errors.works?.[wi]?.description)}
                      helperText={errors.works?.[wi]?.description?.message as string | undefined} />
                  )} />
                  <IconButton aria-label="remove work" onClick={() => works.remove(wi)}><DeleteIcon /></IconButton>
                </Stack>
                <PartsEditor control={control} workIndex={wi} errors={errors} />
              </Stack>
            ))}
            <Button onClick={() => works.append({ description: '', parts: [] })}>{t('event:addWork')}</Button>
      </Stack>
    </Modal>
  );
}

function PartsEditor({ control, workIndex, errors }: {
  control: import('react-hook-form').Control<CreateEventInput>;
  workIndex: number;
  errors: import('react-hook-form').FieldErrors<CreateEventInput>;
}) {
  const { t } = useTranslation(['event']);
  const parts = useFieldArray({ control, name: `works.${workIndex}.parts` });
  const text = (pi: number, field: 'name' | 'brand' | 'partNumber' | 'notes' | 'purchaseLink', label: string) => (
    <Controller name={`works.${workIndex}.parts.${pi}.${field}`} control={control} render={({ field: f }) => {
      const err = errors.works?.[workIndex]?.parts?.[pi]?.[field];
      return (
        <TextField {...f} label={label} size="small" fullWidth value={f.value ?? ''}
          error={Boolean(err)} helperText={err?.message as string | undefined} />
      );
    }} />
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
