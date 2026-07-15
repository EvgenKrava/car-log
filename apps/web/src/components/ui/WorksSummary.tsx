import { Box, Stack, Typography } from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';
import type { CandidateEvent } from '@carlog/contracts';

// Read-only summary of the works + nested parts the extractor found, shown on an
// import/scan review card so the user can see what was parsed (the works/parts commit
// verbatim; they're just not editable in the lightweight review — the full editor is the
// manual Add-service form). Content is user data (descriptions, part names), so nothing
// here is translated. Renders nothing when there are no works.
export function WorksSummary({ works }: { works: CandidateEvent['works'] }) {
  if (!works || works.length === 0) return null;

  return (
    <Box sx={{ mt: 0.5, pl: 0.5, borderLeft: 2, borderColor: 'divider' }}>
      <Stack spacing={0.75} sx={{ pl: 1 }}>
        {works.map((w, wi) => (
          <Box key={wi}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <BuildIcon sx={{ fontSize: 16 }} color="action" />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{w.description}</Typography>
            </Stack>
            {w.parts && w.parts.length > 0 ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 2.75 }}>
                {w.parts.map((p) => (p.quantity > 1 ? `${p.name} ×${p.quantity}` : p.name)).join(', ')}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
