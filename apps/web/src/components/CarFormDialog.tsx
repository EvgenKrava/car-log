import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material';
import { CreateCarSchema, FuelTypeSchema, type Car, type CreateCarInput } from '@carlog/contracts';
import { useCreateCar, useUpdateCar } from '../queries';
import { useBottomSheetDismiss } from './ui/useBottomSheetDismiss';

const FUEL_TYPES = FuelTypeSchema.options;

const EMPTY_DEFAULTS: CreateCarInput = { make: '', model: '', year: 2020, mileage: 0, fuelType: 'petrol' };

const toFormValues = (car: Car): CreateCarInput => ({
  make: car.make,
  model: car.model,
  year: car.year,
  mileage: car.mileage,
  fuelType: car.fuelType,
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
  const sheet = useBottomSheetDismiss(onClose);
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" {...sheet}>
      <form onSubmit={onSubmit}>
        <DialogTitle>{mode === 'edit' ? t('car:editTitle') : t('car:addTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {(create.isError || update.isError) && (
              <Alert severity="error">{t('common:loadingError')} {t('common:tryAgain')}</Alert>
            )}
            {text('make', t('car:make'))}
            {text('model', t('car:model'))}
            {text('year', t('car:year'), 'number')}
            {text('mileage', t('car:mileage'), 'number')}
            {text('nickname', t('car:nickname'))}
            {text('vin', t('car:vin'))}
            {text('licensePlate', t('car:licensePlate'))}
            <Controller name="fuelType" control={control} render={({ field }) => (
              <TextField {...field} select label={t('car:fuelType')} fullWidth>
                {FUEL_TYPES.map((f) => <MenuItem key={f} value={f}>{t(`car:fuelType_${f}`)}</MenuItem>)}
              </TextField>
            )} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button type="submit" variant="contained" disabled={isPending}>
            {mode === 'edit' ? t('car:saveChanges') : t('car:save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
