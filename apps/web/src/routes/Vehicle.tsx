import { useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Badge, BottomNavigation, BottomNavigationAction, Box, Button, Card, CardContent,
  Container, Fab, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Slide, Stack,
  Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ShareIcon from '@mui/icons-material/Share';
import HistoryIcon from '@mui/icons-material/History';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SpeedIcon from '@mui/icons-material/Speed';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PaymentsIcon from '@mui/icons-material/Payments';
import DirectionsCarFilledIcon from '@mui/icons-material/DirectionsCarFilled';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import EvStationIcon from '@mui/icons-material/EvStation';
import type { Car, Event } from '@carlog/contracts';
import { useCar, useDeleteCar, useEvents, useReminders } from '../queries';
import { reminderStatus, todayISO } from '../lib/reminder-view';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AddRecordSheet } from '../components/AddRecordSheet';
import { ImportEventsDialog } from '../components/ImportEventsDialog';
import { ScanInvoiceDialog } from '../components/ScanInvoiceDialog';
import { PhotoGallery, type PhotoGalleryHandle } from '../components/PhotoGallery';
import { RemindersSection, type RemindersSectionHandle } from '../components/RemindersSection';
import { ServiceTimeline } from '../components/ServiceTimeline';
import { SpendSparkline } from '../components/SpendSparkline';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusView } from '../components/ui/StatusView';
import { formatNumber } from '../i18n/format';

// One of the three key facts on the hero — an icon beside a small caps label
// and a prominent value. Icons sit in a tinted square so the row reads as a
// dashboard, not a table; minWidth 0 + noWrap keeps 360px widths safe.
function StatTile({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note?: string }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          color: 'primary.main',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)',
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, lineHeight: 1.4 }}
        >
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
          {value}
          {note ? (
            <Tooltip title={note}>
              <Box component="span" sx={{ ml: 0.4, color: 'text.secondary', cursor: 'help', fontWeight: 600 }}>*</Box>
            </Tooltip>
          ) : null}
        </Typography>
      </Box>
    </Stack>
  );
}

// EU-style plate chip: monospace, bordered, with the accent band on the left.
// A real visual anchor for the car's identity instead of a plain text row.
function PlateChip({ plate }: { plate: string }) {
  return (
    <Stack
      direction="row"
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        height: 26,
      }}
    >
      <Box sx={{ width: 8, bgcolor: 'primary.main' }} />
      <Typography
        component="span"
        sx={{
          px: 1,
          fontFamily: '"SFMono-Regular", ui-monospace, Menlo, monospace',
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: '0.08em',
          display: 'inline-flex',
          alignItems: 'center',
          textTransform: 'uppercase',
        }}
      >
        {plate}
      </Typography>
    </Stack>
  );
}

// VIN as quiet reference detail: label chip + monospace value.
function VinRow({ vin, label }: { vin: string; label: string }) {
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
        {vin}
      </Typography>
    </Stack>
  );
}

const FUEL_ICONS: Record<Car['fuelType'], React.ReactNode> = {
  petrol: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
  diesel: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
  lpg: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
  electric: <EvStationIcon sx={{ fontSize: 16 }} />,
  hybrid: <EvStationIcon sx={{ fontSize: 16 }} />,
  other: <LocalGasStationIcon sx={{ fontSize: 16 }} />,
};

// Total spent across events, grouped by currency; shows the dominant currency's
// sum. When the history mixes currencies, `multi` is set so the tile can flag that
// the figure is a single-currency subtotal rather than a true grand total.
function totalSpent(events: Event[] | undefined, lang: string): { text: string; multi: boolean } | null {
  if (!events?.length) return null;
  const byCurrency = new Map<string, number>();
  for (const e of events) {
    if (e.cost > 0) byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + e.cost);
  }
  if (!byCurrency.size) return null;
  const entries = [...byCurrency.entries()].sort((a, b) => b[1] - a[1]);
  const [currency, sum] = entries[0]!;
  return { text: `${formatNumber(Math.round(sum), lang)} ${currency}`, multi: entries.length > 1 };
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

// The reminders icon for the mobile bottom bar, badged with the due/overdue count
// (mirrors RemindersTabLabel, which badges the desktop tab's text).
function RemindersBadgeIcon({ car }: { car: Car }) {
  const { data: reminders } = useReminders(car.id);
  const today = todayISO();
  const statuses = (reminders ?? []).map((r) => reminderStatus(r, car.mileage, today));
  const overdue = statuses.filter((s) => s === 'overdue').length;
  const due = overdue + statuses.filter((s) => s === 'due_soon').length;
  return (
    <Badge badgeContent={due} color={overdue ? 'error' : 'warning'} max={99}>
      <NotificationsIcon />
    </Badge>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const { t, i18n } = useTranslation(['vehicle', 'car', 'common', 'import', 'photos', 'event', 'reminders']);
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // The universal FAB's add-options sheet (history tab). Photos/reminders trigger
  // their section's add action directly via these imperative handles.
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const photosRef = useRef<PhotoGalleryHandle>(null);
  const remindersRef = useRef<RemindersSectionHandle>(null);
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
  const mileageDisplay = car.mileage > 0 ? `${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}` : t('vehicle:statNotRecorded');
  const fuelDisplay = t(`car:fuelType_${car.fuelType}`);
  // Events power the derived hero stats (record count, total spent). The same
  // query feeds the History tab, so this costs nothing extra.
  const { data: events } = useEvents(car.id);
  const spent = totalSpent(events, i18n.language);

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
          {/* Hero — identity + a small derived dashboard. A soft accent wash
              across the top ties the card to the brand without shouting. */}
          <Card sx={{ overflow: 'hidden' }}>
            <Box
              sx={{
                background: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'linear-gradient(135deg, rgba(91,91,214,0.20) 0%, rgba(91,91,214,0.05) 55%, transparent 100%)'
                    : 'linear-gradient(135deg, rgba(91,91,214,0.10) 0%, rgba(91,91,214,0.03) 55%, transparent 100%)',
              }}
            >
              <CardContent sx={{ p: { xs: 2.5, sm: 3 }, pb: { xs: 2, sm: 2.5 } }}>
                <Stack direction="row" alignItems="flex-start" spacing={{ xs: 1.5, sm: 2 }}>
                  {/* Identity avatar — hidden on the narrowest phones where the
                      title needs every pixel. */}
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: 3,
                      display: { xs: 'none', sm: 'grid' },
                      placeItems: 'center',
                      flexShrink: 0,
                      color: 'primary.main',
                      bgcolor: (theme) =>
                        theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.18)' : 'rgba(91,91,214,0.10)',
                    }}
                  >
                    <DirectionsCarFilledIcon sx={{ fontSize: 30 }} />
                  </Box>

                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                      {title}
                    </Typography>
                    {/* Identity line: make/model (when nicknamed) · year · fuel.
                        Keeping these inline frees the stat row below for facts
                        the user actually tracks. */}
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
                      {car.licensePlate ? <PlateChip plate={car.licensePlate} /> : null}
                    </Stack>
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
              </CardContent>
            </Box>

            {/* Derived dashboard: odometer, record count, total spent — the
                numbers this app exists to keep. Divided row instead of open
                grid so the tiles read as one instrument cluster. */}
            <CardContent sx={{ p: { xs: 2.5, sm: 3 }, pt: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2.5, sm: 3 } } }}>
              <Box
                sx={{
                  display: 'grid',
                  // Mobile-first: one stat per row (full width, nothing truncates).
                  // Desktop keeps the compact 3-across instrument cluster.
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
                  gap: { xs: 1.25, sm: 2 },
                  '& > :not(:first-of-type)': {
                    borderColor: 'divider',
                    // Rows divided by a top border on mobile; columns by a left border on desktop.
                    borderTop: { xs: 1, sm: 0 },
                    borderLeft: { xs: 0, sm: 1 },
                    pt: { xs: 1.25, sm: 0 },
                    pl: { xs: 0, sm: 2 },
                  },
                }}
              >
                <StatTile
                  icon={<SpeedIcon sx={{ fontSize: 20 }} />}
                  label={t('vehicle:statOdometer')}
                  value={mileageDisplay}
                />
                <StatTile
                  icon={<ReceiptLongIcon sx={{ fontSize: 20 }} />}
                  label={t('vehicle:statRecords')}
                  value={events ? String(events.length) : t('vehicle:statNotRecorded')}
                />
                <StatTile
                  icon={<PaymentsIcon sx={{ fontSize: 20 }} />}
                  label={t('vehicle:statSpent')}
                  value={spent?.text ?? t('vehicle:statNotRecorded')}
                  note={spent?.multi ? t('vehicle:statSpentMulti') : undefined}
                />
              </Box>

              {events ? <SpendSparkline events={events} lang={i18n.language} /> : null}

              {car.vin ? (
                <Box sx={{ mt: { xs: 2, sm: 2.5 }, pt: { xs: 1.5, sm: 2 }, borderTop: 1, borderColor: 'divider' }}>
                  <VinRow vin={car.vin} label={t('car:vin')} />
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
              // Desktop: sticky top tab bar. On mobile the tabs live in a fixed
              // iOS-style bottom bar instead (rendered below), so hide this.
              display: { xs: 'none', sm: 'block' },
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
              <PhotoGallery ref={photosRef} carId={car.id} />
            </Box>
          ) : null}
          {tab === 'reminders' ? (
            <Box sx={{ '& > *': { mt: 0 } }}>
              <RemindersSection ref={remindersRef} car={car} />
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
      {/* One universal add button across all tabs: history → options sheet,
          photos → file picker, reminders → new reminder. Slides up into place.
          Sits above the mobile bottom bar (bottom: 88 on xs). */}
      <Slide direction="up" in appear timeout={280}>
        <Fab
          color="primary"
          aria-label={tab === 'photos' ? t('photos:add') : tab === 'reminders' ? t('reminders:add') : t('event:addRecord')}
          onClick={() => {
            if (tab === 'history') setAddSheetOpen(true);
            else if (tab === 'photos') photosRef.current?.openPicker();
            else remindersRef.current?.openAdd();
          }}
          sx={{ position: 'fixed', right: 24, bottom: { xs: 88, sm: 24 } }}
        >
          <AddIcon />
        </Fab>
      </Slide>
      <AddRecordSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onScan={() => setScanOpen(true)}
        onImport={() => setImportOpen(true)}
        onManual={() => setManualOpen(true)}
      />

      {/* iOS-style bottom tab bar — mobile only. Fixed to the bottom edge with a
          hairline top border and safe-area padding for notched devices. Desktop
          uses the sticky top Tabs above. */}
      <Paper
        elevation={0}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          display: { xs: 'block', sm: 'none' },
          zIndex: (theme) => theme.zIndex.appBar,
          borderTop: 1,
          borderColor: 'divider',
          pb: 'env(safe-area-inset-bottom)',
        }}
      >
        <BottomNavigation value={tab} onChange={(_, v: TabKey) => setTab(v)} showLabels>
          <BottomNavigationAction value="history" label={t('vehicle:tabHistory')} icon={<HistoryIcon />} />
          <BottomNavigationAction value="photos" label={t('vehicle:tabPhotos')} icon={<PhotoLibraryIcon />} />
          <BottomNavigationAction value="reminders" label={t('vehicle:tabReminders')} icon={<RemindersBadgeIcon car={car} />} />
        </BottomNavigation>
      </Paper>
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
