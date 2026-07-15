import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Button, Card, CardContent, Chip, Container, IconButton, ListItemIcon,
  ListItemText, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ShareIcon from '@mui/icons-material/Share';
import type { Car } from '@carlog/contracts';
import { useCar, useDeleteCar } from '../queries';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportEventsDialog } from '../components/ImportEventsDialog';
import { ScanInvoiceDialog } from '../components/ScanInvoiceDialog';
import { PhotoGallery } from '../components/PhotoGallery';
import { ServiceTimeline } from '../components/ServiceTimeline';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusView } from '../components/ui/StatusView';
import { formatNumber } from '../i18n/format';

function SpecRow({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 500 }}>{value}</Typography>
    </Stack>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const { t, i18n } = useTranslation(['vehicle', 'car', 'common', 'import']);
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const title = car.nickname || `${car.make} ${car.model}`;
  const onDelete = async () => { await del.mutateAsync(car.id); navigate('/', { replace: true }); };

  // Native share of a plain-text car summary; clipboard fallback where Web Share is
  // unavailable (most desktop browsers). A public read-only link is a later Phase-4 feature.
  const onShare = async () => {
    const summary = [
      title,
      `${car.make} ${car.model}${car.year ? ` (${car.year})` : ''}`,
      `${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}`,
    ].join('\n');
    try {
      if (navigator.share) await navigator.share({ title, text: summary });
      else await navigator.clipboard.writeText(summary);
    } catch {
      /* user dismissed the share sheet, or clipboard denied — no-op */
    }
  };

  return (
    <AppShell>
      <PageHeader title={title} onBack={() => navigate('/')} />
      <Container sx={{ py: 3 }}>
        <Card>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">{car.make} {car.model}</Typography>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Chip label={t(`car:fuelType_${car.fuelType}`)} color="primary" variant="outlined" />
                {/* Car actions live on the card, not the app header. */}
                <IconButton size="small" aria-label={t('vehicle:carActions')} onClick={(e) => setMenuAnchor(e.currentTarget)}>
                  <MoreVertIcon />
                </IconButton>
                <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
                  <MenuItem onClick={() => { setMenuAnchor(null); setEditOpen(true); }}>
                    <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t('common:edit')}</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { setMenuAnchor(null); void onShare(); }}>
                    <ListItemIcon><ShareIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t('common:share')}</ListItemText>
                  </MenuItem>
                  <MenuItem onClick={() => { setMenuAnchor(null); setConfirmOpen(true); }} sx={{ color: 'error.main' }}>
                    <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
                    <ListItemText>{t('common:delete')}</ListItemText>
                  </MenuItem>
                </Menu>
              </Stack>
            </Stack>
            <SpecRow label={t('car:year')} value={car.year} />
            <SpecRow label={t('car:mileage')} value={`${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}`} />
            {car.nickname ? <SpecRow label={t('car:nickname')} value={car.nickname} /> : null}
            {car.vin ? <SpecRow label={t('car:vin')} value={car.vin} /> : null}
            {car.licensePlate ? <SpecRow label={t('car:licensePlate')} value={car.licensePlate} /> : null}
          </CardContent>
        </Card>
        <PhotoGallery carId={car.id} />
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mb: 1 }}>
          <Button variant="outlined" onClick={() => setScanOpen(true)}>{t('import:scanInvoice')}</Button>
          <Button variant="outlined" onClick={() => setImportOpen(true)}>{t('import:trigger')}</Button>
        </Stack>
        <ServiceTimeline carId={car.id} />
        {del.isError ? <Alert severity="error" sx={{ mt: 2 }}>{t('vehicle:deleteFailed')}</Alert> : null}
      </Container>
      <CarFormDialog open={editOpen} onClose={() => setEditOpen(false)} mode="edit" car={car} />
      <ConfirmDialog
        open={confirmOpen}
        title={t('car:deleteTitle')}
        message={t('car:deleteConfirm')}
        onConfirm={onDelete}
        onClose={() => setConfirmOpen(false)}
        loading={del.isPending}
      />
      <ImportEventsDialog carId={car.id} open={importOpen} onClose={() => setImportOpen(false)} />
      <ScanInvoiceDialog carId={car.id} open={scanOpen} onClose={() => setScanOpen(false)} />
    </AppShell>
  );
}

export function Vehicle() {
  const { t } = useTranslation(['vehicle', 'common']);
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: car, isLoading, isError } = useCar(id);

  if (isLoading) return <AppShell><StatusView state="loading" /></AppShell>;
  if (isError || !car) {
    return (
      <AppShell>
        <Container sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>{t('vehicle:notFound')}</Typography>
          <Button variant="contained" onClick={() => navigate('/')}>{t('vehicle:backToGarage')}</Button>
        </Container>
      </AppShell>
    );
  }
  return <VehicleDetail car={car} />;
}
