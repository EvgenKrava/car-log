import { Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Car } from '@carlog/contracts';
import { formatNumber } from '../../i18n/format';

export function VehicleCard({ car, onClick }: { car: Car; onClick: () => void }) {
  const { t, i18n } = useTranslation(['vehicle']);
  const title = car.nickname || `${car.make} ${car.model}`;
  return (
    <Card sx={{ transition: 'box-shadow .15s, transform .15s', '&:hover': { transform: 'translateY(-2px)' } }}>
      <CardActionArea onClick={onClick} sx={{ p: 0.5 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="h6" noWrap>{title}</Typography>
            <Chip label={car.fuelType} size="small" color="primary" variant="outlined" />
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {car.year} · {formatNumber(car.mileage, i18n.language)} {t('vehicle:mileageUnit')}
          </Typography>
          {car.nickname ? (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5 }}>
              {car.make} {car.model}
            </Typography>
          ) : null}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
