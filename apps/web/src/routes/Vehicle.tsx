import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Badge, Box, Button, Card, CardContent, Container, IconButton, ListItemIcon,
  ListItemText, Menu, MenuItem, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ShareIcon from '@mui/icons-material/Share';
import HistoryIcon from '@mui/icons-material/History';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import NotificationsIcon from '@mui/icons-material/Notifications';
import type { Car } from '@carlog/contracts';
import { useCar, useDeleteCar, useReminders } from '../queries';
import { reminderStatus, todayISO } from '../lib/reminder-view';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportEventsDialog } from '../components/ImportEventsDialog';
import { ScanInvoiceDialog } from '../components/ScanInvoiceDialog';
import { PhotoGallery } from '../components/PhotoGallery';
import { RemindersSection } from '../components/RemindersSection';
import { ServiceTimeline } from '../components/ServiceTimeline';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusView } from '../components/ui/StatusView';
import { formatNumber } from '../i18n/format';

// One of the three key facts on the hero — a small caps label above a
// prominent value. No icon: keeps the tiles readable even at 360px width
// where a leading avatar would squeeze the value.
function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 600, mt: 0.25 }} noWrap>{value}</Typography>
    </Box>
  );
}

// Secondary identity facts (VIN, plate) sit under a divider so they read as
// reference detail rather than headline stats. Monospace for VIN/plate makes
// character-by-character scanning easier.
function MetaField({ label, value, monospace }: { label: string; value: string; monospace?: boolean }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 500,
          fontFamily: monospace ? '"SFMono-Regular", ui-monospace, Menlo, monospace' : undefined,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

const TAB_KEYS = ['history', 'photos', 'reminders'] as const;
type TabKey = (typeof TAB_KEYS)[number];
const isTabKey = (v: string | null): v is TabKey => TAB_KEYS.includes(v as TabKey);

// The Reminders tab label carries a due/overdue count so action items are
// discoverable even while the user is on another tab.
function RemindersTabLabel({ car }: { car: Car }) {
  const { t } = useTranslation(['vehicle']);
  const { data: reminders } = useReminders(car.id);
  const today = todayISO();
  const statuses = (reminders ?? []).map((r) => reminderStatus(r, car.mileage, today));
  const overdue = statuses.filter((s) => s === 'overdue').length;
  const due = overdue + statuses.filter((s) => s === 'due_soon').length;
  return (
    <Badge badgeContent={due} color={overdue ? 'error' : 'warning'} max={99}
      sx={{ '& .MuiBadge-badge': { right: -14, top: 2 } }}>
      {t('vehicle:tabReminders')}
    </Badge>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const { t, i18n } = useTranslation(['vehicle', 'car', 'common', 'import', 'photos']);
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // Active tab lives in the URL (?tab=photos) so refresh and back/forward keep
  // the user's place; the default (history) stays out of the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'history';
  const setTab = (next: TabKey) =>
    setSearchParams(next === 'history' ? {} : { tab: next }, { replace: true });

  const title = car.nickname || `${car.make} ${car.model}`;
  const hasNickname = Boolean(car.nickname);
  // A 0 mileage means "not recorded" (e.g. imported history without odometer data) — show a dash.
  const mileageDisplay = car.mileage > 0 ? `${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}` : '—';
  const fuelDisplay = t(`car:fuelType_${car.fuelType}`);
  const hasSecondary = Boolean(car.vin || car.licensePlate);

  const onDelete = async () => { await del.mutateAsync(car.id); navigate('/', { replace: true }); };

  // Native share of a plain-text car summary; clipboard fallback where Web Share is
  // unavailable (most desktop browsers). A public read-only link is a later Phase-4 feature.
  const onShare = async () => {
    const summary = [
      title,
      `${car.make} ${car.model}${car.year ? ` (${car.year})` : ''}`,
      car.mileage > 0 ? mileageDisplay : null,
    ].filter(Boolean).join('\n');
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
      {/* maxWidth=md keeps the reading measure tight on desktop; py=3 xs / py=4 sm+
          gives the hero room to breathe. */}
      <Container maxWidth="md" sx={{ py: { xs: 3, sm: 4 } }}>
        <Stack spacing={{ xs: 2.5, sm: 3 }}>
          {/* Hero — identity + headline stats. Everything else on the page is
              in service of this card. */}
          <Card>
            <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
              <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                    {title}
                  </Typography>
                  {hasNickname ? (
                    <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                      {car.make} {car.model}
                    </Typography>
                  ) : null}
                </Box>
                <IconButton
                  size="small"
                  aria-label={t('vehicle:carActions')}
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                  sx={{ mt: -0.5, mr: -0.5 }}
                >
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

              {/* Three headline stats. CSS grid keeps them evenly sized on
                  every width and still readable at 360px. */}
              <Box
                sx={{
                  mt: { xs: 2.5, sm: 3 },
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: { xs: 2, sm: 3 },
                }}
              >
                <StatTile label={t('car:mileage')} value={mileageDisplay} />
                <StatTile label={t('car:year')} value={String(car.year)} />
                <StatTile label={t('car:fuelType')} value={fuelDisplay} />
              </Box>

              {hasSecondary ? (
                <Box
                  sx={{
                    mt: { xs: 2.5, sm: 3 },
                    pt: { xs: 2, sm: 2.5 },
                    borderTop: 1,
                    borderColor: 'divider',
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: { xs: 1.5, sm: 3 },
                  }}
                >
                  {car.vin ? <MetaField label={t('car:vin')} value={car.vin} monospace /> : null}
                  {car.licensePlate ? <MetaField label={t('car:licensePlate')} value={car.licensePlate} monospace /> : null}
                </Box>
              ) : null}
            </CardContent>
          </Card>

          {/* Tab bar — history is the primary tab (per project docs, "the
              timeline is the primary screen"); photos and reminders each get
              their own uncluttered surface. Sticky under the app bar so the
              tabs stay reachable while scrolling a long timeline. */}
          <Box
            sx={{
              position: 'sticky',
              top: { xs: 56, sm: 64 },
              zIndex: (theme) => theme.zIndex.appBar - 1,
              bgcolor: 'background.default',
              mx: { xs: -2, sm: 0 },
              px: { xs: 2, sm: 0 },
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Tabs
              value={tab}
              onChange={(_, v: TabKey) => setTab(v)}
              variant="fullWidth"
              sx={{
                minHeight: 44,
                '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontWeight: 600 },
              }}
            >
              <Tab value="history" icon={<HistoryIcon fontSize="small" />} iconPosition="start" label={t('vehicle:tabHistory')} />
              <Tab value="photos" icon={<PhotoLibraryIcon fontSize="small" />} iconPosition="start" label={t('vehicle:tabPhotos')} />
              <Tab value="reminders" icon={<NotificationsIcon fontSize="small" />} iconPosition="start" label={<RemindersTabLabel car={car} />} />
            </Tabs>
          </Box>

          {/* Panels. The wrapper Box neutralises each section's built-in top
              margin so the outer Stack controls spacing. Panels render only
              when active — TanStack Query caches keep tab switches instant. */}
          {tab === 'history' ? (
            <Box sx={{ '& > *': { mt: 0 } }}>
              <ServiceTimeline
                carId={car.id}
                addOpen={manualOpen}
                onAddOpenChange={setManualOpen}
                onScan={() => setScanOpen(true)}
                onImport={() => setImportOpen(true)}
              />
            </Box>
          ) : null}
          {tab === 'photos' ? (
            <Box sx={{ '& > *': { mt: 0 } }}>
              <PhotoGallery carId={car.id} />
            </Box>
          ) : null}
          {tab === 'reminders' ? (
            <Box sx={{ '& > *': { mt: 0 } }}>
              <RemindersSection car={car} />
            </Box>
          ) : null}

          {del.isError ? <Alert severity="error">{t('vehicle:deleteFailed')}</Alert> : null}
        </Stack>
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
