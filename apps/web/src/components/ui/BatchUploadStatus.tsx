import { Box, CircularProgress, List, ListItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import type { BatchItem } from '../../lib/use-batch-upload';

export function BatchUploadStatus({ items, running }: { items: BatchItem[]; running: boolean }) {
  const { t } = useTranslation(['common']);
  if (!items.length) return null;

  const total = items.filter((i) => i.state !== 'skipped').length;
  const done = items.filter((i) => i.state === 'done' || i.state === 'failed').length;

  const icon = (i: BatchItem) => {
    if (i.state === 'uploading') return <CircularProgress size={18} />;
    if (i.state === 'done') return <CheckCircleIcon color="success" fontSize="small" />;
    if (i.state === 'failed') return <ErrorIcon color="error" fontSize="small" />;
    if (i.state === 'skipped') return <RemoveCircleIcon color="disabled" fontSize="small" />;
    return <ScheduleIcon color="disabled" fontSize="small" />;
  };

  return (
    <Box sx={{ mb: 2, border: 1, borderColor: 'divider', borderRadius: 2, p: 1 }}>
      {running ? (
        <Typography variant="body2" sx={{ mb: 0.5 }}>{t('common:batchUploading', { done, total })}</Typography>
      ) : null}
      <List dense disablePadding>
        {items.map((i) => (
          <ListItem key={i.id} disableGutters>
            <ListItemIcon sx={{ minWidth: 32 }}>{icon(i)}</ListItemIcon>
            <ListItemText
              primary={i.name}
              secondary={i.reasonKey ? t(i.reasonKey, i.params) : undefined}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
