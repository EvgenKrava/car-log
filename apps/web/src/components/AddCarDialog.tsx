import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from '@mui/material';
import { CreateCarSchema, FuelTypeSchema, type CreateCarInput } from '@carlog/contracts';
import { useCreateCar } from '../queries';

const FUEL_TYPES = FuelTypeSchema.options;

export function AddCarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mutateAsync, isPending } = useCreateCar();
  const { control, handleSubmit, reset, formState: { errors } } = useForm<CreateCarInput>({
    resolver: zodResolver(CreateCarSchema),
    defaultValues: { make: '', model: '', year: 2020, mileage: 0, fuelType: 'petrol' },
  });

  const onSubmit = handleSubmit(async (data) => { await mutateAsync(data); reset(); onClose(); });

  const text = (name: keyof CreateCarInput, label: string, type = 'text') => (
    <Controller name={name} control={control} render={({ field }) => (
      <TextField {...field} label={label} type={type} fullWidth
        value={field.value ?? ''}
        onChange={(e) => field.onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        error={Boolean(errors[name])} helperText={errors[name]?.message as string | undefined} />
    )} />
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={onSubmit}>
        <DialogTitle>Add a car</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {text('make', 'Make')}
            {text('model', 'Model')}
            {text('year', 'Year', 'number')}
            {text('mileage', 'Mileage', 'number')}
            {text('nickname', 'Nickname')}
            {text('vin', 'VIN')}
            {text('licensePlate', 'License plate')}
            <Controller name="fuelType" control={control} render={({ field }) => (
              <TextField {...field} select label="Fuel type" fullWidth>
                {FUEL_TYPES.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
              </TextField>
            )} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isPending}>Save</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
