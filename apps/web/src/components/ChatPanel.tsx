import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Chip, CircularProgress, IconButton, Stack, TextField, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import type { ChatMessage } from '@carlog/contracts';
import { useChatWithCar } from '../queries';

// A single chat bubble. User turns are accent-filled and right-aligned; assistant turns
// are a plain surface bubble on the left. Whitespace is preserved so the model's line
// breaks survive.
function Bubble({ role, content }: ChatMessage) {
  const mine = role === 'user';
  return (
    <Box sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <Box
        sx={{
          maxWidth: '85%',
          px: 1.5,
          py: 1,
          borderRadius: 2.5,
          borderTopRightRadius: mine ? 0.5 : 2.5,
          borderTopLeftRadius: mine ? 2.5 : 0.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          bgcolor: mine ? 'primary.main' : (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'grey.100'),
          color: mine ? 'primary.contrastText' : 'text.primary',
          border: mine ? 0 : 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{content}</Typography>
      </Box>
    </Box>
  );
}

export function ChatPanel({ carId }: { carId: string }) {
  const { t } = useTranslation(['chat', 'common']);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const chat = useChatWithCar(carId);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn (and the pending indicator) in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chat.isPending]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || chat.isPending) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    chat.mutate(next, {
      onSuccess: ({ reply }) => setMessages((m) => [...m, { role: 'assistant', content: reply }]),
      // On error the user turn stays in the thread and the error banner shows; the user
      // can edit/resend. We don't auto-remove their message.
    });
  };

  const suggestions = [
    t('chat:suggestionSpend'),
    t('chat:suggestionDue'),
    t('chat:suggestionSummary'),
  ];

  return (
    <Stack spacing={1.5}>
      {messages.length === 0 ? (
        <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', py: 4, px: 2, color: 'text.secondary' }}>
          <Box sx={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'primary.main',
            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)') }}>
            <SmartToyOutlinedIcon />
          </Box>
          <Typography variant="body2">{t('chat:empty')}</Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 1 }}>
            {suggestions.map((s) => (
              <Chip key={s} label={s} variant="outlined" onClick={() => send(s)} sx={{ cursor: 'pointer' }} />
            ))}
          </Stack>
        </Stack>
      ) : (
        <Stack spacing={1.25}>
          {messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}
        </Stack>
      )}

      {chat.isPending ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', px: 0.5 }}>
          <CircularProgress size={14} />
          <Typography variant="caption">{t('chat:thinking')}</Typography>
        </Stack>
      ) : null}

      {chat.isError ? <Alert severity="error" sx={{ mt: 0.5 }}>{t('chat:error')}</Alert> : null}

      <Box
        component="form"
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', position: 'sticky', bottom: 0, pt: 1 }}
      >
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={5}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline (desktop convention).
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
          placeholder={t('chat:placeholder')}
          aria-label={t('chat:placeholder')}
        />
        <IconButton type="submit" color="primary" disabled={!input.trim() || chat.isPending} aria-label={t('chat:send')}>
          <SendIcon />
        </IconButton>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
        {t('chat:disclaimer')}
      </Typography>
    </Stack>
  );
}