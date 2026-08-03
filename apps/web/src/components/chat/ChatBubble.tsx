import { Box, Chip, Stack, Typography } from '@mui/material';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import type { ChatMessageView, ChatAttachmentView } from '@carlog/contracts';

function AttachmentView({ a }: { a: ChatAttachmentView }) {
  if (a.contentType === 'application/pdf') {
    return (
      <Chip icon={<InsertDriveFileOutlinedIcon />} label={a.filename ?? 'PDF'}
        component="a" href={a.url} target="_blank" clickable variant="outlined" size="small" sx={{ maxWidth: 220 }} />
    );
  }
  return (
    <Box component="a" href={a.url} target="_blank" sx={{ display: 'block', lineHeight: 0 }}>
      <Box component="img" src={a.url} alt={a.filename ?? ''} loading="lazy"
        sx={{ maxWidth: 220, maxHeight: 200, borderRadius: 1.5, border: 1, borderColor: 'divider' }} />
    </Box>
  );
}

export function ChatBubble({ role, content, attachments }: ChatMessageView) {
  const mine = role === 'user';
  return (
    <Box sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <Stack spacing={0.75} sx={{ maxWidth: '85%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {attachments.length > 0 ? (
          <Stack spacing={0.5} sx={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
            {attachments.map((a) => <AttachmentView key={a.key} a={a} />)}
          </Stack>
        ) : null}
        {content ? (
          <Box sx={{
            px: 1.5, py: 1, borderRadius: 2.5,
            borderTopRightRadius: mine ? 0.5 : 2.5, borderTopLeftRadius: mine ? 2.5 : 0.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            bgcolor: mine ? 'primary.main' : (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'grey.100'),
            color: mine ? 'primary.contrastText' : 'text.primary',
            border: mine ? 0 : 1, borderColor: 'divider',
          }}>
            <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{content}</Typography>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
