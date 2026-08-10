import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Snackbar, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Car, CreateCarInput } from '@carlog/contracts';
import { useUpdateCar } from '../queries';
import { Modal } from './ui/Modal';
import { NumberField } from './ui/NumberField';
import { formatNumber } from '../i18n/format';

const BUMPS = [50, 100, 500];

// The full CreateCarInput the update-car mutation expects — everything about the car
// except the mileage field this sheet exists to change.
const toUpdateInput = (car: Car, mileage: number): CreateCarInput => ({
  make: car.make,
  model: car.model,
  year: car.year,
  mileage,
  fuelType: car.fuelType,
  engineVolume: car.engineVolume,
  nickname: car.nickname,
  vin: car.vin,
  licensePlate: car.licensePlate,
});

// Tap-to-update sheet for the one number people actually change often: the odometer.
// Opens from the vehicle hero's odometer stat tile and from a push notification deep
// link (?odometer=1). Deliberately narrow — just the mileage field plus quick bumps —
// so logging a fresh reading takes one tap, not the full car-edit form.
export function QuickOdometerSheet({ open, onClose, car }: { open: boolean; onClose: () => void; car: Car }) {
  const { t, i18n } = useTranslation(['vehicle', 'common']);
  const update = useUpdateCar(car.id);
  const [mileage, setMileage] = useState<number | undefined>(car.mileage);
  const [savedOpen, setSavedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMileage(car.mileage);
    update.reset();
  }, [open, car.mileage, update]);

  const lower = mileage !== undefined && mileage < car.mileage;

  const onSave = async () => {
    if (mileage === undefined) return;
    try {
      await update.mutateAsync(toUpdateInput(car, mileage));
      onClose();
      setSavedOpen(true);
    } catch {
      // mutation state (update.isError) drives the UI
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={update.isPending ? undefined : onClose}
        title={t('vehicle:odometerTitle')}
        maxWidth="xs"
        actions={
          <>
            <Button onClick={onClose} disabled={update.isPending}>{t('common:cancel')}</Button>
            <Button onClick={() => void onSave()} variant="contained" disabled={update.isPending || mileage === undefined}>
              {t('vehicle:odometerSave')}
            </Button>
          </>
        }
      >
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {update.isError ? <Alert severity="error">{t('common:loadingError')} {t('common:tryAgain')}</Alert> : null}
          <NumberField
            value={mileage}
            onChange={setMileage}
            label={t('vehicle:statOdometer')}
            fullWidth
            autoFocus
            inputProps={{ inputMode: 'numeric', style: { fontSize: 28, fontWeight: 700 } }}
          />
          <Stack direction="row" spacing={1}>
            {BUMPS.map((bump) => (
              <Chip
                key={bump}
                label={`+${bump}`}
                onClick={() => setMileage((prev) => (prev ?? car.mileage) + bump)}
                sx={{ fontWeight: 600 }}
              />
            ))}
          </Stack>
          {lower ? (
            <Typography variant="body2" color="warning.main">{t('vehicle:odometerLower')}</Typography>
          ) : null}
        </Stack>
      </Modal>
      <Snackbar
        open={savedOpen}
        autoHideDuration={4000}
        onClose={() => setSavedOpen(false)}
        message={t('vehicle:odometerUpdated', { value: formatNumber(mileage ?? car.mileage, i18n.language) })}
      />
    </>
  );
}
