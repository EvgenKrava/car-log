import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button, CircularProgress, IconButton, Stack, TextField, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useChatSessions, useDeleteChatSession, useRenameChatSession } from '../queries';
import { formatDate } from '../i18n/format';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ConfirmDialog';

// The Chat tab: a list of the car's chat sessions. Opening one navigates to the
// dedicated full-screen conversation page (/cars/:id/chat/:sid).
export function ChatPanel({ carId }: { carId: string }) {
  const { t, i18n } = useTranslation(['chat', 'common']);
  const navigate = useNavigate();
  const sessions = useChatSessions(carId);
  const deleteSession = useDeleteChatSession(carId);
  const renameSession = useRenameChatSession(carId);

  const [renaming, setRenaming] = useState<{ sid: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const openChat = (sid: string) => navigate(`/cars/${carId}/chat/${sid}`);

  const list = sessions.data ?? [];

  return (
    <Stack spacing={1.5}>
      {sessions.isLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={22} /></Stack>
      ) : list.length === 0 ? (
        <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', py: 5, px: 2, color: 'text.secondary' }}>
          <Box sx={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'primary.main',
            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)') }}>
            <SmartToyOutlinedIcon />
          </Box>
          <Typography variant="body2">{t('chat:empty')}</Typography>
        </Stack>
      ) : (
        <Stack spacing={1}>
          {list.map((s) => (
            <Stack key={s.id} direction="row" alignItems="center" spacing={1}
              sx={{ p: 1, borderRadius: 2, border: 1, borderColor: 'divider' }}>
              <ChatBubbleOutlineIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
              <Box component="button" type="button" onClick={() => openChat(s.id)}
                sx={{ flexGrow: 1, minWidth: 0, textAlign: 'left', border: 0, bgcolor: 'transparent', cursor: 'pointer', color: 'text.primary', p: 0 }}>
                <Typography noWrap sx={{ fontWeight: 600 }}>{s.title || t('chat:newChat')}</Typography>
                <Typography variant="caption" color="text.secondary">{formatDate(s.updatedAt, i18n.language)}</Typography>
              </Box>
              <IconButton size="small" aria-label={t('chat:rename')} onClick={() => setRenaming({ sid: s.id, title: s.title })}><EditOutlinedIcon fontSize="small" /></IconButton>
              <IconButton size="small" color="error" aria-label={t('common:delete')} onClick={() => setDeleting(s.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
              <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
            </Stack>
          ))}
        </Stack>
      )}

      <Modal
        open={renaming !== null} onClose={() => setRenaming(null)} title={t('chat:renameTitle')}
        onSubmit={(e) => {
          e.preventDefault();
          if (renaming && renaming.title.trim()) void renameSession.mutateAsync({ sid: renaming.sid, title: renaming.title.trim() });
          setRenaming(null);
        }}
        actions={<Button type="submit" variant="contained">{t('common:save')}</Button>}
      >
        <TextField autoFocus fullWidth size="small" value={renaming?.title ?? ''}
          onChange={(e) => setRenaming((r) => (r ? { ...r, title: e.target.value } : r))} inputProps={{ maxLength: 120 }} />
      </Modal>

      <ConfirmDialog
        open={deleting !== null} title={t('chat:deleteTitle')} message={t('chat:deleteConfirm')}
        confirmLabel={t('common:delete')} loading={deleteSession.isPending}
        onConfirm={async () => { if (deleting) { await deleteSession.mutateAsync(deleting); setDeleting(null); } }}
        onClose={() => setDeleting(null)} />
    </Stack>
  );
}
