import { Box, Card, CardContent, Skeleton, Stack } from '@mui/material';

// Content-shaped loading placeholders (design system: skeletons for content, spinners
// for operations). Each mirrors its real component's layout closely enough that the
// loaded content replaces it without shifting anything around it. The global
// prefers-reduced-motion clamp silences the wave animation.

// Mirrors VehicleCard: title + chip row, year/mileage line, nickname line.
export function VehicleCardSkeleton() {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Skeleton animation="wave" width="55%" height={28} />
          <Skeleton animation="wave" variant="rounded" width={64} height={24} />
        </Stack>
        <Skeleton animation="wave" width="40%" sx={{ mt: 0.5 }} />
        <Skeleton animation="wave" width="50%" sx={{ mt: 0.5 }} />
      </CardContent>
    </Card>
  );
}

// Mirrors an EventCard: accordion summary with icon, date, metadata, title.
export function TimelineEntrySkeleton() {
  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1, borderRadius: 2, '&:before': { display: 'none' },
        '&:first-of-type': { borderRadius: 2 },
        '&:last-of-type': { borderRadius: 2 },
      }}
    >
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Skeleton animation="wave" variant="circular" width={34} height={34} />
          <Skeleton animation="wave" width={96} height={20} />
          <Skeleton animation="wave" width="35%" height={16} />
        </Stack>
        <Skeleton animation="wave" width="70%" sx={{ mt: 1 }} />
      </CardContent>
    </Card>
  );
}

// Mirrors ReminderCard: category chip + title, anchor status, date/km chips, buttons.
export function ReminderCardSkeleton() {
  return (
    <Card variant="outlined" sx={{ mb: 1, borderRadius: 2 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Skeleton animation="wave" variant="rounded" width={96} height={24} />
          <Skeleton animation="wave" width="40%" />
        </Stack>
        <Skeleton animation="wave" width="30%" height={28} sx={{ mt: 0.5 }} />
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          <Skeleton animation="wave" variant="rounded" width={80} height={24} />
          <Skeleton animation="wave" variant="rounded" width={80} height={24} />
        </Stack>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
          <Skeleton animation="wave" variant="rounded" width={100} height={32} />
        </Stack>
      </CardContent>
    </Card>
  );
}

// Mirrors a ChatPanel session row: icon, two text lines, trailing icons.
export function ChatSessionRowSkeleton() {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ p: 1, borderRadius: 2, border: 1, borderColor: 'divider', mb: 1 }}
    >
      <Skeleton animation="wave" variant="circular" width={20} height={20} />
      <Box sx={{ flexGrow: 1 }}>
        <Skeleton animation="wave" width="60%" />
        <Skeleton animation="wave" width="30%" height={16} />
      </Box>
      <Skeleton animation="wave" variant="circular" width={28} height={28} />
    </Stack>
  );
}

// An assistant-shaped chat message: avatar + two text lines.
export function ChatBubbleSkeleton() {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', mb: 2 }}>
      <Skeleton animation="wave" variant="circular" width={30} height={30} />
      <Box sx={{ flexGrow: 1, pt: 0.25 }}>
        <Skeleton animation="wave" width="80%" />
        <Skeleton animation="wave" width="55%" />
      </Box>
    </Stack>
  );
}

// The Vehicle page hero: title, plate line, stat-tile row.
export function VehicleHeroSkeleton() {
  return (
    <Box sx={{ mb: 2 }}>
      <Skeleton animation="wave" width="45%" height={36} />
      <Skeleton animation="wave" width="30%" sx={{ mt: 0.5 }} />
      <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} animation="wave" variant="rounded" width={104} height={64} />
        ))}
      </Stack>
    </Box>
  );
}

// Admin dashboard stat tiles.
export function DashboardTilesSkeleton() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} animation="wave" variant="rounded" width={160} height={88} />
      ))}
    </Stack>
  );
}

// Admin user management card.
export function UserRowSkeleton() {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box>
            <Skeleton animation="wave" width={120} />
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              <Skeleton animation="wave" variant="rounded" width={64} height={24} />
              <Skeleton animation="wave" variant="rounded" width={48} height={24} />
            </Stack>
            <Skeleton animation="wave" width={100} height={16} sx={{ mt: 0.5 }} />
          </Box>
          <Skeleton animation="wave" variant="circular" width={28} height={28} />
        </Stack>
      </CardContent>
    </Card>
  );
}
