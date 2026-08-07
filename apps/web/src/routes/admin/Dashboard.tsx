import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box, Card, CardContent, Chip, Container, Stack, Tooltip, Typography, useTheme,
} from '@mui/material';
import GroupIcon from '@mui/icons-material/Group';
import ShieldIcon from '@mui/icons-material/Shield';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PaymentsIcon from '@mui/icons-material/Payments';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { ActivityItem, EventCategory } from '@carlog/contracts';
import { useAdminMetrics } from '../../queries';
import { AppShell } from '../../components/ui/AppShell';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusView } from '../../components/ui/StatusView';
import { EmptyState } from '../../components/ui/EmptyState';
import { DashboardTilesSkeleton } from '../../components/ui/skeletons';
import { CATEGORY_META, categoryTint } from '../../lib/event-category';
import { formatDate, formatNumber } from '../../i18n/format';

// One of the four headline numbers — icon in a tinted square beside a small
// caps label and a prominent value, matching the vehicle hero's StatTile so
// the dashboard reads as part of the same system rather than a new one.
function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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
          bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)'),
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
        </Typography>
      </Box>
    </Stack>
  );
}

// Dependency-free inline bar chart over API-traffic points — mirrors
// SpendSparkline's approach: baseline-anchored bars, 4px rounded tops, a
// small minimum height so a quiet day still reads, single accent hue (no
// legend needed for one series), and a per-bar hover tooltip with the exact
// figure.
function ApiTrafficChart({ points, lang }: { points: { date: string; count: number }[]; lang: string }) {
  if (!points.length) return null;
  const max = Math.max(1, ...points.map((p) => p.count));
  return (
    <Stack direction="row" alignItems="flex-end" spacing={0.5} sx={{ height: 72 }}>
      {points.map((p) => (
        <Tooltip key={p.date} title={`${formatDate(p.date, lang)} · ${formatNumber(p.count, lang)}`} arrow>
          <Stack sx={{ flex: 1, minWidth: 0, height: '100%', justifyContent: 'flex-end', cursor: 'default' }}>
            <Box
              sx={{
                width: '100%',
                height: `${Math.max(4, (p.count / max) * 100)}%`,
                bgcolor: 'primary.main',
                borderRadius: '4px 4px 0 0',
                transition: 'opacity .15s',
                '&:hover': { opacity: 0.82 },
              }}
            />
          </Stack>
        </Tooltip>
      ))}
    </Stack>
  );
}

function ActivityRow({ item, lang }: { item: ActivityItem; lang: string }) {
  const { t } = useTranslation(['event']);
  const theme = useTheme();
  const isKnownCategory = (Object.keys(CATEGORY_META) as string[]).includes(item.category);
  const category: EventCategory = isKnownCategory ? (item.category as EventCategory) : 'other';
  const { color, Icon } = CATEGORY_META[category];
  const ownerShort = item.ownerId.slice(0, 8);

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
      <Chip
        icon={<Icon sx={{ fontSize: 15, color: `${color} !important` }} />}
        label={t(`event:category_${category}`)}
        size="small"
        sx={{ minWidth: 0, color, bgcolor: categoryTint(color, theme.palette.mode), border: 1, borderColor: 'transparent' }}
      />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" noWrap>{formatDate(item.createdAt, lang)}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>{ownerShort}</Typography>
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
        {formatNumber(item.cost, lang)} {item.currency}
      </Typography>
    </Stack>
  );
}

export function Dashboard() {
  const { t, i18n } = useTranslation(['admin']);
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAdminMetrics();

  const trafficPoints = useMemo(() => data?.apiTraffic ?? [], [data]);

  return (
    <AppShell>
      <PageHeader title={t('admin:dashboardTitle')} onBack={() => navigate('/')} />
      <Container maxWidth="sm" sx={{ py: 3 }}>
        {isLoading ? (
          <DashboardTilesSkeleton />
        ) : isError || !data ? (
          <StatusView state="error" message={t('admin:dashboardLoadError')} />
        ) : (
          <Stack spacing={2}>
            <Card>
              <CardContent>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' },
                    gap: { xs: 1.25, sm: 2 },
                    '& > :not(:first-of-type)': {
                      borderColor: 'divider',
                      borderTop: { xs: 1, sm: 0 },
                      borderLeft: { xs: 0, sm: 1 },
                      pt: { xs: 1.25, sm: 0 },
                      pl: { xs: 0, sm: 2 },
                    },
                  }}
                >
                  <StatTile
                    icon={<GroupIcon sx={{ fontSize: 20 }} />}
                    label={t('admin:metricUsers')}
                    value={formatNumber(data.users.total, i18n.language)}
                  />
                  <StatTile
                    icon={<ShieldIcon sx={{ fontSize: 20 }} />}
                    label={t('admin:metricAdmins')}
                    value={formatNumber(data.users.admins, i18n.language)}
                  />
                  <StatTile
                    icon={<PersonAddIcon sx={{ fontSize: 20 }} />}
                    label={t('admin:metricNew30d')}
                    value={formatNumber(data.users.newLast30d, i18n.language)}
                  />
                  <StatTile
                    icon={<PaymentsIcon sx={{ fontSize: 20 }} />}
                    label={t('admin:metricCost')}
                    value={`${formatNumber(Math.round(data.cost.amount), i18n.language)} ${data.cost.currency}`}
                  />
                </Box>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, mb: 1.5 }}
                >
                  {t('admin:apiTraffic')}
                </Typography>
                <ApiTrafficChart points={trafficPoints} lang={i18n.language} />
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
                  <Chip
                    color="error"
                    icon={<ErrorOutlineIcon />}
                    label={`${t('admin:errors4xx')}: ${formatNumber(data.errors.count4xx, i18n.language)}`}
                  />
                  <Chip
                    color="warning"
                    icon={<WarningAmberIcon />}
                    label={`${t('admin:errors5xx')}: ${formatNumber(data.errors.count5xx, i18n.language)}`}
                  />
                </Stack>
                <Typography color="text.secondary">
                  {t('admin:p95Latency')}: {formatNumber(data.errors.p95LatencyMs, i18n.language)} ms
                </Typography>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, mb: 0.5 }}
                >
                  {t('admin:recentActivity')}
                </Typography>
                {data.activity.length ? (
                  <Stack divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
                    {data.activity.map((item, i) => (
                      <ActivityRow key={`${item.carId}-${item.createdAt}-${i}`} item={item} lang={i18n.language} />
                    ))}
                  </Stack>
                ) : (
                  <EmptyState title={t('admin:noActivity')} />
                )}
              </CardContent>
            </Card>
          </Stack>
        )}
      </Container>
    </AppShell>
  );
}
