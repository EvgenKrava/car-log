import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, Button, MenuItem, Stack, TextField } from '@mui/material';
import { CreateCarSchema, FuelTypeSchema, type Car, type CreateCarInput } from '@carlog/contracts';
import { useCreateCar, useUpdateCar } from '../queries';
import { Modal } from './ui/Modal';

const FUEL_TYPES = FuelTypeSchema.options;

const EMPTY_DEFAULTS: CreateCarInput = { make: '', model: '', year: 2020, mileage: 0, fuelType: 'petrol' };

const toFormValues = (car: Car): CreateCarInput => ({
  make: car.make,
  model: car.model,
  year: car.year,
  mileage: car.mileage,
  fuelType: car.fuelType,
  engineVolume: car.engineVolume,
  nickname: car.nickname,
  vin: car.vin,
  licensePlate: car.licensePlate,
});

type CarFormDialogProps = {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  car?: Car;
};

export function CarFormDialog({ open, onClose, mode, car }: CarFormDialogProps) {
  const { t } = useTranslation(['car', 'common']);
  const create = useCreateCar();
  const update = useUpdateCar(car?.id ?? '');
  const isPending = create.isPending || update.isPending;

  const { control, handleSubmit, reset, formState: { errors } } = useForm<CreateCarInput>({
    resolver: zodResolver(CreateCarSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  // Re-populate whenever the dialog opens (or the target car changes) so edit
  // shows the right vehicle and create starts blank.
  useEffect(() => {
    if (!open) return;
    reset(mode === 'edit' && car ? toFormValues(car) : EMPTY_DEFAULTS);
  }, [open, mode, car, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (mode === 'edit' && car) {
      await update.mutateAsync(data);
    } else {
      await create.mutateAsync(data);
    }
    reset(EMPTY_DEFAULTS);
    onClose();
  });

  const text = (name: keyof CreateCarInput, label: string, type = 'text') => (
    <Controller name={name} control={control} render={({ field }) => (
      <TextField {...field} label={label} type={type} fullWidth
        value={field.value ?? ''}
        onChange={(e) => field.onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        error={Boolean(errors[name])} helperText={errors[name]?.message as string | undefined} />
    )} />
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      onSubmit={onSubmit}
      title={mode === 'edit' ? t('car:editTitle') : t('car:addTitle')}
      contentSx={{ pt: 1 }}
      actions={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? t('car:saveChanges') : t('car:save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ mt: 1 }}>
        {(create.isError || update.isError) && (
          <Alert severity="error">{t('common:loadingError')} {t('common:tryAgain')}</Alert>
        )}
        {text('make', t('car:make'))}
        {text('model', t('car:model'))}
        {text('year', t('car:year'), 'number')}
        {text('mileage', t('car:mileage'), 'number')}
        {/* Optional decimal (liters): empty must become undefined, not 0 —
            the schema rejects 0 and EVs simply leave it blank. */}
        <Controller name="engineVolume" control={control} render={({ field }) => (
          <TextField {...field} label={t('car:engineVolume')} type="number" fullWidth
            value={field.value ?? ''}
            onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            inputProps={{ step: 0.1, min: 0.1, inputMode: 'decimal' }}
            error={Boolean(errors.engineVolume)} helperText={errors.engineVolume?.message} />
        )} />
        {text('nickname', t('car:nickname'))}
        {text('vin', t('car:vin'))}
        {text('licensePlate', t('car:licensePlate'))}
        <Controller name="fuelType" control={control} render={({ field }) => (
          <TextField {...field} select label={t('car:fuelType')} fullWidth>
            {FUEL_TYPES.map((f) => <MenuItem key={f} value={f}>{t(`car:fuelType_${f}`)}</MenuItem>)}
          </TextField>
        )} />
      </Stack>
    </Modal>
  );
}
