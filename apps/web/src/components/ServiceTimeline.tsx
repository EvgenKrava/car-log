import { useMemo, useState } from 'react';
import {
  Box, Button, Chip, InputAdornment, Stack, TextField, Typography, useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useTranslation } from 'react-i18next';
import { EVENT_CATEGORIES, type Event, type EventCategory } from '@carlog/contracts';
import { useEvents } from '../queries';
import { CATEGORY_META, categoryTint } from '../lib/event-category';
import { AddRecordMenu } from './AddRecordMenu';
import { EventCard } from './EventCard';
import { EventFormDialog } from './EventFormDialog';
import { EmptyState } from './ui/EmptyState';
import { StatusView } from './ui/StatusView';
import { Reveal } from './ui/Reveal';

// Does an event match the free-text query? Searches the fields a user would
// reasonably remember: title, notes, and every work description / part name.
function matchesQuery(e: Event, q: string): boolean {
  if (!q) return true;
  const hay = [
    e.title, e.notes,
    ...e.works.flatMap((w) => [w.description, ...w.parts.map((p) => p.name)]),
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

const yearOf = (dateISO: string): string => dateISO.slice(0, 4);

// `addOpen`/`onAddOpenChange` let a parent (Vehicle) drive the manual "add service" dialog.
// `onScan`/`onImport` let the parent also wire the other two ingestion paths — when all
// three are provided the title shows an "Add" button opening a 3-option menu (matching the
// SpeedDial). When the callbacks are omitted the component stands alone with its own inline
// "Add service" button and self-managed manual dialog.
export function ServiceTimeline({
  carId, addOpen, onAddOpenChange, onScan, onImport,
}: {
  carId: string;
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
  onScan?: () => void;
  onImport?: () => void;
}) {
  const { t } = useTranslation(['event']);
  const theme = useTheme();
  const { data: events, isLoading, isError } = useEvents(carId);
  const [selfOpen, setSelfOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EventCategory | 'all'>('all');

  const controlled = onAddOpenChange !== undefined;
  const open = controlled ? Boolean(addOpen) : selfOpen;
  const setOpen = (v: boolean) => (controlled ? onAddOpenChange!(v) : setSelfOpen(v));
  // The 3-option menu needs all three actions wired; otherwise fall back to the plain button.
  const hasMenu = Boolean(onScan && onImport);

  const total = events?.length ?? 0;

  // Newest first, then filter by category + query, then group by year for the dividers.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = [...(events ?? [])]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .filter((e) => (category === 'all' || e.category === category) && matchesQuery(e, q));
    const byYear = new Map<string, Event[]>();
    for (const e of filtered) {
      const y = yearOf(e.date);
      (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(e);
    }
    return [...byYear.entries()]; // insertion order === sorted (newest) order
  }, [events, query, category]);

  const matchCount = groups.reduce((n, [, list]) => n + list.length, 0);
  const filtersActive = category !== 'all' || query.trim().length > 0;

  return (
    <Box sx={{ mt: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">{t('event:sectionTitle')}</Typography>
        {/* On the vehicle page the FAB (driven by the parent) is the sole add
            affordance, matching the garage's single-FAB pattern — so no header
            button here. The AddRecordMenu stays mounted for the empty-state button.
            Standalone use (no parent callbacks) keeps its own inline button. */}
        {hasMenu ? (
          <AddRecordMenu
            anchorEl={menuAnchor}
            onClose={() => setMenuAnchor(null)}
            onScan={onScan!}
            onImport={onImport!}
            onManual={() => setOpen(true)}
          />
        ) : controlled ? null : (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>{t('event:addService')}</Button>
        )}
      </Stack>

      {/* Filter/search bar — only meaningful once there's a history to sift. A row of
          category chips (tinted with each category's colour) plus a search field. */}
      {total > 0 ? (
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          <TextField
            size="small"
            fullWidth
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('event:searchPlaceholder')}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              endAdornment: query ? (
                <InputAdornment position="end">
                  <ClearIcon fontSize="small" sx={{ cursor: 'pointer' }} onClick={() => setQuery('')} />
                </InputAdornment>
              ) : null,
            }}
          />
          <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5, '&::-webkit-scrollbar': { display: 'none' } }}>
            <Chip
              label={t('event:filterAll')}
              size="small"
              onClick={() => setCategory('all')}
              color={category === 'all' ? 'primary' : 'default'}
              variant={category === 'all' ? 'filled' : 'outlined'}
            />
            {EVENT_CATEGORIES.map((c) => {
              const { color, Icon } = CATEGORY_META[c];
              const active = category === c;
              return (
                <Chip
                  key={c}
                  icon={<Icon sx={{ fontSize: 15, color: `${color} !important` }} />}
                  label={t(`event:category_${c}`)}
                  size="small"
                  onClick={() => setCategory(active ? 'all' : c)}
                  sx={{
                    flexShrink: 0,
                    color,
                    fontWeight: 600,
                    bgcolor: active ? categoryTint(color, theme.palette.mode) : 'transparent',
                    border: 1,
                    borderColor: active ? 'transparent' : 'divider',
                  }}
                />
              );
            })}
          </Stack>
        </Stack>
      ) : null}

      {isLoading ? (
        <StatusView state="loading" />
      ) : isError ? (
        <StatusView state="error" message={t('event:loadError')} />
      ) : total === 0 ? (
        <EmptyState
          title={t('event:empty')}
          description={t('event:emptyHint')}
          action={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={(e) => (hasMenu ? setMenuAnchor(e.currentTarget) : setOpen(true))}
            >
              {t('event:emptyAction')}
            </Button>
          }
        />
      ) : matchCount === 0 ? (
        <Stack alignItems="center" spacing={1.5} sx={{ py: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('event:noMatches')}</Typography>
          {filtersActive ? (
            <Button size="small" onClick={() => { setQuery(''); setCategory('all'); }}>{t('event:clearFilters')}</Button>
          ) : null}
        </Stack>
      ) : (
        <Box>
          {(() => {
            let i = 0; // continuous index across year groups, so the stagger doesn't reset per year
            return groups.map(([year, list]) => (
              <Box key={year} sx={{ mb: 2 }}>
                {/* Year divider — a quiet marker so a long history reads as chapters. */}
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ display: 'block', fontWeight: 700, letterSpacing: '0.08em', mb: 0.5 }}
                >
                  {year}
                </Typography>
                {list.map((e) => (
                  <Reveal key={e.id} index={i++}>
                    <EventCard carId={carId} event={e} />
                  </Reveal>
                ))}
              </Box>
            ));
          })()}
        </Box>
      )}
      <EventFormDialog open={open} onClose={() => setOpen(false)} carId={carId} mode="create" />
    </Box>
  );
}