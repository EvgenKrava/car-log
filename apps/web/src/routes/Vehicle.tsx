import { useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Badge, BottomNavigation, BottomNavigationAction, Box, Button, Card, CardContent,
  Container, Fab, Fade, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack,
  Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';

import PublicIcon from '@mui/icons-material/Public';
import HistoryIcon from '@mui/icons-material/History';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import SpeedIcon from '@mui/icons-material/Speed';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PaymentsIcon from '@mui/icons-material/Payments';
import DirectionsCarFilledIcon from '@mui/icons-material/DirectionsCarFilled';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import EvStationIcon from '@mui/icons-material/EvStation';
import type { Car, Event } from '@carlog/contracts';
import { useCar, useDeleteCar, useEvents, useReminders, useCreateChatSession } from '../queries';
import { reminderStatus, todayISO } from '../lib/reminder-view';
import { CarFormDialog } from '../components/CarFormDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShareCarDialog } from '../components/ShareCarDialog';
import { AddRecordSheet } from '../components/AddRecordSheet';
import { ImportEventsDialog } from '../components/ImportEventsDialog';
import { ScanInvoiceDialog } from '../components/ScanInvoiceDialog';
import { ChatPanel } from '../components/ChatPanel';
import { RemindersSection, type RemindersSectionHandle } from '../components/RemindersSection';
import { ServiceTimeline } from '../components/ServiceTimeline';
import { SpendSparkline } from '../components/SpendSparkline';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusView } from '../components/ui/StatusView';
import { formatNumber } from '../i18n/format';
import { tokens } from '../theme/tokens';
import { buildCarExport } from '../lib/car-export';
import { downloadJson, exportFilename } from '../lib/download-json';

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

const TAB_KEYS = ['history', 'chat', 'reminders'] as const;
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
function RemindersBadgeIcon({ car, active }: { car: Car; active: boolean }) {
  const { data: reminders } = useReminders(car.id);
  const today = todayISO();
  const statuses = (reminders ?? []).map((r) => reminderStatus(r, car.mileage, today));
  const overdue = statuses.filter((s) => s === 'overdue').length;
  const due = overdue + statuses.filter((s) => s === 'due_soon').length;
  const Bell = active ? NotificationsIcon : NotificationsNoneIcon;
  return (
    <Badge badgeContent={due} color={overdue ? 'error' : 'warning'} max={99}>
      <Bell />
    </Badge>
  );
}

function VehicleDetail({ car }: { car: Car }) {
  const { t, i18n } = useTranslation(['vehicle', 'car', 'common', 'import', 'event', 'reminders', 'share', 'chat']);
  const navigate = useNavigate();
  const del = useDeleteCar();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  // The universal FAB's add-options sheet (history tab). Reminders triggers its
  // section's add action directly via this imperative handle.
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const remindersRef = useRef<RemindersSectionHandle>(null);
  // Active tab lives in the URL (?tab=reminders) so refresh and back/forward keep
  // the user's place; the default (history) stays out of the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'history';
  const setTab = (next: TabKey) =>
    setSearchParams(next === 'history' ? {} : { tab: next }, { replace: true });

  // The add action depends on the active tab: history → options sheet,
  // reminders → new reminder; chat → start a new chat session (same "+" affordance
  // as the other tabs). Shared by the desktop FAB and the mobile bottom bar's "+".
  const createChatSession = useCreateChatSession(car.id);
  const triggerAdd = () => {
    if (tab === 'chat') void createChatSession.mutateAsync().then((s) => navigate(`/cars/${car.id}/chat/${s.id}`));
    else if (tab === 'reminders') remindersRef.current?.openAdd();
    else setAddSheetOpen(true);
  };

  const title = car.nickname || `${car.make} ${car.model}`;
  const hasNickname = Boolean(car.nickname);
  // A 0 mileage means "not recorded" (e.g. imported history without odometer data) — show a dash.
  const mileageDisplay = car.mileage > 0 ? `${formatNumber(car.mileage, i18n.language)} ${t('vehicle:mileageUnit')}` : t('vehicle:statNotRecorded');
  const fuelDisplay = t(`car:fuelType_${car.fuelType}`);
  // Events power the derived hero stats (record count, total spent). The same
  // query feeds the History tab, so this costs nothing extra.
  const { data: events } = useEvents(car.id);
  const spent = totalSpent(events, i18n.language);
  // Cached by RemindersTabLabel/RemindersBadgeIcon already; fetched here too so
  // the export menu item has reminders in scope without waiting on the tab render.
  const { data: reminders } = useReminders(car.id);

  const onDelete = async () => { await del.mutateAsync(car.id); navigate('/', { replace: true }); };
  const onExport = () => {
    if (!events || !reminders) return;
    const today = new Date().toISOString().slice(0, 10);
    const file = buildCarExport(car, events, reminders, new Date().toISOString());
    downloadJson(exportFilename(car.make, car.model, today), file);
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
                    <MenuItem onClick={() => { setMenuAnchor(null); setShareOpen(true); }}>
                      <ListItemIcon><PublicIcon fontSize="small" /></ListItemIcon>
                      <ListItemText>{t('share:menu')}</ListItemText>
                    </MenuItem>
                    <MenuItem onClick={() => { setMenuAnchor(null); onExport(); }}>
                      <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
                      <ListItemText>{t('vehicle:exportHistory')}</ListItemText>
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
              timeline is the primary screen"); reminders gets its own
              uncluttered surface. Sticky under the app bar so the tabs stay
              reachable while scrolling a long timeline. */}
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
              <Tab value="chat" icon={<SmartToyIcon fontSize="small" />} iconPosition="start" label={t('vehicle:tabChat')} />
              <Tab value="reminders" icon={<NotificationsIcon fontSize="small" />} iconPosition="start" label={<RemindersTabLabel car={car} />} />
            </Tabs>
          </Box>

          {/* Panels. The wrapper Box neutralises each section's built-in top
              margin so the outer Stack controls spacing. Panels render only
              when active — TanStack Query caches keep tab switches instant.
              The Fade's `key={tab}` forces a fresh mount per switch, which is
              what restarts the fade-in (a re-render alone wouldn't). */}
          <Fade in key={tab} timeout={tokens.motion.duration.fast}>
            <Box sx={{ '& > *': { mt: 0 } }}>
              {tab === 'history' ? (
                <ServiceTimeline
                  carId={car.id}
                  addOpen={manualOpen}
                  onAddOpenChange={setManualOpen}
                  onScan={() => setScanOpen(true)}
                  onImport={() => setImportOpen(true)}
                />
              ) : tab === 'chat' ? (
                <ChatPanel carId={car.id} />
              ) : (
                <RemindersSection ref={remindersRef} car={car} />
              )}
            </Box>
          </Fade>

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
      <ShareCarDialog open={shareOpen} onClose={() => setShareOpen(false)} car={car} />
      <ImportEventsDialog carId={car.id} open={importOpen} onClose={() => setImportOpen(false)} />
      <ScanInvoiceDialog carId={car.id} open={scanOpen} onClose={() => setScanOpen(false)} />
      {/* Add affordance. Desktop (no bottom bar) → a FAB; mobile → the "+" lives in
          the bottom bar as a labeled item (below). Per-tab action: history → options
          sheet, reminders → new reminder. */}
      <Fab
        color="primary"
        aria-label={tab === 'chat' ? t('chat:newChat') : tab === 'reminders' ? t('reminders:add') : t('event:addRecord')}
        onClick={triggerAdd}
        sx={{ display: { xs: 'none', sm: 'flex' }, position: 'fixed', right: 24, bottom: 24,
          '@keyframes carlogFabIn': {
            from: { opacity: 0, transform: 'scale(0.8)' },
            to: { opacity: 1, transform: 'scale(1)' },
          },
          animation: `carlogFabIn ${tokens.motion.duration.base}ms ${tokens.motion.easing.standard}`,
          transition: `transform ${tokens.motion.duration.fast}ms ${tokens.motion.easing.standard}`,
          '&:active': { transform: 'scale(0.96)' } }}
      >
        <AddIcon />
      </Fab>
      <AddRecordSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onScan={() => setScanOpen(true)}
        onImport={() => setImportOpen(true)}
        onManual={() => setManualOpen(true)}
      />

      {/* Mobile bottom nav — a floating frosted capsule of the tabs, plus a SEPARATE
          circular add button beside it. Desktop uses the top Tabs + the FAB above. */}
      <Box
        sx={{
          position: 'fixed',
          left: 16,
          right: 16,
          bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
          display: { xs: 'flex', sm: 'none' },
          gap: 1.25,
          alignItems: 'stretch',
          zIndex: (theme) => theme.zIndex.appBar,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            flexGrow: 1,
            minWidth: 0,
            borderRadius: 999,
            overflow: 'hidden',
            border: 1,
            borderColor: 'divider',
            boxShadow: '0 6px 24px rgba(16,24,40,0.18)',
            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(38,42,48,0.72)' : 'rgba(255,255,255,0.82)'),
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          }}
        >
          <BottomNavigation
            value={tab}
            showLabels
            onChange={(_, v: TabKey) => setTab(v)}
            sx={{
              bgcolor: 'transparent',
              height: 62,
              px: 0.5,
              '& .MuiBottomNavigationAction-root': {
                minWidth: 0,
                my: 0.75,
                mx: 0.25,
                // Fully-rounded highlight to match the capsule's own (pill) rounding.
                borderRadius: 999,
                color: 'text.secondary',
                transition: 'background-color .2s ease, color .2s ease',
                // Highlight ONLY the action root (not the label span, which also carries
                // .Mui-selected — a bare `& .Mui-selected` would double-tint the label).
                '&.Mui-selected': {
                  color: (theme) => (theme.palette.mode === 'dark' ? '#fff' : theme.palette.primary.main),
                  bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(91,91,214,0.12)'),
                },
              },
              '& .MuiBottomNavigationAction-label': { fontSize: 10, mt: '3px' },
              // Keep the selected label the same size, transparent bg, inheriting the root's colour.
              '& .MuiBottomNavigationAction-label.Mui-selected': { fontSize: 10, bgcolor: 'transparent', color: 'inherit' },
              '& .MuiSvgIcon-root': { fontSize: 24 },
            }}
          >
            <BottomNavigationAction value="history" label={t('vehicle:tabHistory')} icon={<HistoryIcon />} />
            <BottomNavigationAction
              value="chat"
              label={t('vehicle:tabChat')}
              icon={tab === 'chat' ? <SmartToyIcon /> : <SmartToyOutlinedIcon />}
            />
            <BottomNavigationAction
              value="reminders"
              label={t('vehicle:tabReminders')}
              icon={<RemindersBadgeIcon car={car} active={tab === 'reminders'} />}
            />
          </BottomNavigation>
        </Paper>
        <Box
            component="button"
            type="button"
            onClick={triggerAdd}
            aria-label={tab === 'chat' ? t('chat:newChat') : tab === 'reminders' ? t('reminders:add') : t('event:addRecord')}
            sx={{
              flexShrink: 0,
              width: 62,
              p: 0,
              border: 1,
              borderColor: 'divider',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              color: 'primary.main',
              boxShadow: '0 6px 24px rgba(16,24,40,0.18)',
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(38,42,48,0.72)' : 'rgba(255,255,255,0.82)'),
              backdropFilter: 'saturate(180%) blur(20px)',
              WebkitBackdropFilter: 'saturate(180%) blur(20px)',
              transition: 'transform .1s ease',
              '&:active': { transform: 'scale(0.94)' },
            }}
          >
            <AddIcon />
          </Box>
      </Box>
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
