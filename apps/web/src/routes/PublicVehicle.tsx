import { Link as RouterLink, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box, Button, Card, CardContent, Chip, Container, Link, Stack, Typography, useTheme,
} from '@mui/material';
import DirectionsCarFilledIcon from '@mui/icons-material/DirectionsCarFilled';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import EvStationIcon from '@mui/icons-material/EvStation';
import type { EventCategory, FuelType, PublicCar, PublicEvent } from '@carlog/contracts';
import { usePublicCar } from '../queries';
import { CATEGORY_META, categoryTint } from '../lib/event-category';
import { formatDate, formatNumber } from '../i18n/format';
import { StatusView } from '../components/ui/StatusView';
import { EmptyState } from '../components/ui/EmptyState';

const FUEL_ICONS: Record<FuelType, React.ReactNode> = {
  petrol: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
  diesel: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
  lpg: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
  electric: <EvStationIcon sx={{ fontSize: 16 }} />,
  hybrid: <EvStationIcon sx={{ fontSize: 16 }} />,
  other: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
};

// VIN/plate as a quiet reference detail — label chip + monospace value, mirroring
// Vehicle.tsx's VinRow but generic enough for either field.
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: '0.06em' }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontFamily: '"SFMono-Regular", ui-monospace, Menlo, monospace',
          fontWeight: 500,
          letterSpacing: '0.04em',
          wordBreak: 'break-all',
          color: 'text.secondary',
        }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

function PublicHero({ car }: { car: PublicCar }) {
  const { t, i18n } = useTranslation(['share', 'car', 'vehicle']);
  const title = car.nickname || `${car.make} ${car.model}`;
  const hasNickname = Boolean(car.nickname);
  const fuelDisplay = t(`car:fuelType_${car.fuelType}`);
  const mileageDisplay = car.mileage > 0 ? `${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}` : t('vehicle:statNotRecorded');

  return (
    <Card sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          background: (theme) =>
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(91,91,214,0.20) 0%, rgba(91,91,214,0.05) 55%, transparent 100%)'
              : 'linear-gradient(135deg, rgba(91,91,214,0.10) 0%, rgba(91,91,214,0.03) 55%, transparent 100%)',
        }}
      >
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack direction="row" alignItems="flex-start" spacing={{ xs: 1.5, sm: 2 }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 3,
                display: { xs: 'none', sm: 'grid' },
                placeItems: 'center',
                flexShrink: 0,
                color: 'primary.main',
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.18)' : 'rgba(91,91,214,0.10)'),
              }}
            >
              <DirectionsCarFilledIcon sx={{ fontSize: 30 }} />
            </Box>

            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                {title}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.75 }}>
                <Typography color="text.secondary" variant="body2" sx={{ fontWeight: 500 }}>
                  {hasNickname ? `${car.make} ${car.model} · ` : ''}{car.year}
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
                  {FUEL_ICONS[car.fuelType]}
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {fuelDisplay}
                    {car.engineVolume ? ` ${formatNumber(car.engineVolume, i18n.language)}L` : ''}
                  </Typography>
                </Stack>
              </Stack>
            </Box>

            <Chip label={t('share:readOnly')} size="small" sx={{ flexShrink: 0 }} />
          </Stack>
        </CardContent>
      </Box>

      <CardContent sx={{ p: { xs: 2.5, sm: 3 }, pt: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2.5, sm: 3 } } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {t('vehicle:statOdometer')}
          </Typography>
          <Typography sx={{ fontWeight: 700 }}>{mileageDisplay}</Typography>
        </Stack>

        {car.vin || car.licensePlate ? (
          <Stack spacing={1} sx={{ mt: { xs: 2, sm: 2.5 }, pt: { xs: 1.5, sm: 2 }, borderTop: 1, borderColor: 'divider' }}>
            {car.vin ? <DetailRow label={t('car:vin')} value={car.vin} /> : null}
            {car.licensePlate ? <DetailRow label={t('car:licensePlate')} value={car.licensePlate} /> : null}
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PublicEventCard({ event }: { event: PublicEvent }) {
  const { t, i18n } = useTranslation(['event', 'share']);
  const theme = useTheme();
  const isKnownCategory = (Object.keys(CATEGORY_META) as string[]).includes(event.category);
  const category: EventCategory = isKnownCategory ? (event.category as EventCategory) : 'other';
  const { color, Icon } = CATEGORY_META[category];
  const partsCount = event.works.reduce((n, w) => n + w.parts.length, 0);

  return (
    <Card sx={{ borderRadius: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Box
            role="img"
            aria-label={t(`event:category_${category}`)}
            title={t(`event:category_${category}`)}
            sx={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              display: 'grid', placeItems: 'center',
              color, bgcolor: categoryTint(color, theme.palette.mode),
            }}
          >
            <Icon sx={{ fontSize: 19 }} />
          </Box>
          <Typography sx={{ fontWeight: 600 }}>{formatDate(`${event.date}T00:00:00.000Z`, i18n.language)}</Typography>
          {event.mileage > 0 || event.cost > 0 ? (
            <Typography color="text.secondary">
              {[
                event.mileage > 0 ? formatNumber(event.mileage, i18n.language) : null,
                event.cost > 0 ? `${formatNumber(event.cost, i18n.language)} ${event.currency}` : null,
              ].filter(Boolean).join(' · ')}
            </Typography>
          ) : null}
        </Stack>

        {event.title ? <Typography sx={{ fontWeight: 600, mt: 1.5 }}>{event.title}</Typography> : null}
        {event.notes ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{event.notes}</Typography> : null}

        {event.works.length ? (
          <>
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
              {t('event:worksSummary', { works: event.works.length, parts: partsCount })}
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {event.works.map((w, i) => (
                <Typography key={i} variant="body2">
                  • {w.description}
                  {w.parts.length ? ` — ${w.parts.map((p) => `${p.name}×${p.quantity}`).join(', ')}` : ''}
                </Typography>
              ))}
            </Stack>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PublicVehicleDetail({ car }: { car: PublicCar }) {
  const { t } = useTranslation(['share', 'event']);
  const events = [...car.events].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Container maxWidth="md" sx={{ py: { xs: 3, sm: 4 } }}>
        <Stack spacing={{ xs: 2.5, sm: 3 }}>
          <PublicHero car={car} />

          {events.length ? (
            <Stack spacing={1.5}>
              {events.map((event) => <PublicEventCard key={event.id} event={event} />)}
            </Stack>
          ) : (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              {t('event:empty')}
            </Typography>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
            <Link component={RouterLink} to="/" underline="hover">
              {t('share:sharedVia')}
            </Link>
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}

export function PublicVehicle() {
  const { t } = useTranslation(['share']);
  const { carId = '' } = useParams<{ carId: string }>();
  const { data: car, isLoading, isError } = usePublicCar(carId);

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Container maxWidth="md">
          <StatusView state="loading" />
        </Container>
      </Box>
    );
  }

  if (isError || !car) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <Container maxWidth="md">
          <EmptyState
            title={t('share:notShared')}
            action={<Button component={RouterLink} to="/" variant="contained">{t('share:sharedVia')}</Button>}
          />
        </Container>
      </Box>
    );
  }

  return <PublicVehicleDetail car={car} />;
}
