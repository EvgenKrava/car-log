import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Chip, CircularProgress, Container, IconButton, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { PageHeader } from '../components/ui/PageHeader';
import { ChatBubble } from '../components/chat/ChatBubble';
import { VoiceComposerButton } from '../components/chat/VoiceComposerButton';
import { useSpeechRecognition } from '../lib/useSpeechRecognition';
import { useChatSession, useCreateChatSession, usePostChatMessage, useResolveChatAction } from '../queries';

const MAX_ATTACH = 4;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export function ChatConversation() {
  const { t, i18n } = useTranslation(['chat', 'common']);
  const { id = '', sid = '' } = useParams();
  const navigate = useNavigate();

  const session = useChatSession(id, sid);
  const post = usePostChatMessage(id);
  const createSession = useCreateChatSession(id);
  const resolve = useResolveChatAction(id);

  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<{ content: string; names: string[] } | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const speech = useSpeechRecognition();
  const [seconds, setSeconds] = useState(0);

  // Stream the live transcript into the editable field, so it can be corrected before sending.
  useEffect(() => {
    if (speech.listening && speech.transcript) setInput(speech.transcript);
  }, [speech.listening, speech.transcript]);

  useEffect(() => {
    if (!speech.listening) { setSeconds(0); return; }
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [speech.listening]);

  const backToList = () => navigate(`/cars/${id}?tab=chat`);

  // Stale/expired/deleted session → return to the list.
  useEffect(() => {
    if (session.isError) backToList();
  }, [session.isError]);

  const messages = session.data?.messages ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending, post.isPending]);

  const onPickFiles = (fl: FileList | null) => {
    setAttachError(null);
    if (!fl) return;
    const picked = Array.from(fl);
    const room = MAX_ATTACH - files.length;
    if (picked.length > room) setAttachError(t('chat:attachTooMany', { max: MAX_ATTACH }));
    setFiles((prev) => [...prev, ...picked.slice(0, Math.max(0, room))]);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && files.length === 0) || post.isPending) return;
    if (speech.listening) speech.stop();
    const sentFiles = files;
    const rawInput = input;
    setPending({ content: text, names: sentFiles.map((f) => f.name) });
    setInput('');
    setFiles([]);
    try {
      await post.mutateAsync({ sid, content: text, files: sentFiles });
    } catch {
      setInput(rawInput);
      setFiles(sentFiles);
    } finally {
      setPending(null);
    }
  };

  const startNewChat = async () => {
    const s = await createSession.mutateAsync();
    navigate(`/cars/${id}/chat/${s.id}`);
  };

  const suggestions = [t('chat:suggestionRemind'), t('chat:suggestionSpend'), t('chat:suggestionDue'), t('chat:suggestionSummary')];

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <PageHeader
        title={session.data?.title || t('chat:newChat')}
        onBack={backToList}
        actions={<IconButton onClick={startNewChat} aria-label={t('chat:newChat')} disabled={createSession.isPending} color="inherit"><AddIcon /></IconButton>}
      />
      <Container maxWidth="md" sx={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', py: 2 }}>
        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
          {session.isLoading ? (
            <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={22} /></Stack>
          ) : messages.length === 0 && !pending ? (
            <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', py: 4, px: 2, color: 'text.secondary' }}>
              <Box sx={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'primary.main',
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)') }}>
                <SmartToyOutlinedIcon />
              </Box>
              <Typography variant="body2">{t('chat:empty')}</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 1 }}>
                {suggestions.map((s) => <Chip key={s} label={s} variant="outlined" onClick={() => setInput(s)} sx={{ cursor: 'pointer' }} />)}
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={2}>
              {messages.map((m, i) => (
                <ChatBubble key={i} {...m}
                  resolving={resolve.isPending}
                  onResolveAction={(aid, confirm) => { void resolve.mutateAsync({ sid, aid, confirm }); }} />
              ))}
              {pending ? (
                <ChatBubble role="user" content={pending.content} createdAt="" actions={[]}
                  attachments={pending.names.map((n, i) => ({ key: `p${i}`, contentType: 'application/pdf' as const, filename: n, size: 0, url: '#' }))} />
              ) : null}
            </Stack>
          )}
          {post.isPending ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', px: 0.5, mt: 1 }}>
              <CircularProgress size={14} /><Typography variant="caption">{t('chat:thinking')}</Typography>
            </Stack>
          ) : null}
          <div ref={endRef} />
        </Box>

        {post.isError ? <Alert severity="error" sx={{ mb: 1 }}>{t('chat:error')}</Alert> : null}
        {resolve.isError ? <Alert severity="error" sx={{ mb: 1 }}>{t('chat:actionError')}</Alert> : null}
        {attachError ? <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setAttachError(null)}>{attachError}</Alert> : null}
        {speech.error ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {speech.error === 'denied' ? t('chat:voiceDenied') : t('chat:error')}
          </Alert>
        ) : null}

        {files.length > 0 ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
            {files.map((f, i) => (
              <Chip key={i} label={f.name} onDelete={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                icon={f.type === 'application/pdf' ? <InsertDriveFileOutlinedIcon /> : undefined} size="small" sx={{ maxWidth: 200 }} />
            ))}
          </Stack>
        ) : null}

        <Box component="form" onSubmit={(e) => { e.preventDefault(); void send(); }} sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end' }}>
          <input ref={fileInputRef} type="file" accept={ACCEPT} multiple hidden
            onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }} />
          <IconButton onClick={() => fileInputRef.current?.click()} aria-label={t('chat:attach')} disabled={files.length >= MAX_ATTACH}><AttachFileIcon /></IconButton>
          <TextField fullWidth size="small" multiline maxRows={5} value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={t('chat:placeholder')} aria-label={t('chat:placeholder')} />
          <VoiceComposerButton
            supported={speech.supported}
            listening={speech.listening}
            seconds={seconds}
            canSend={Boolean(input.trim()) || files.length > 0}
            sending={post.isPending}
            onStart={() => { speech.reset(); speech.start(i18n.language.startsWith('uk') ? 'uk-UA' : 'en-US'); }}
            onStop={() => speech.stop()}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mt: 0.5 }}>{t('chat:disclaimer')}</Typography>
      </Container>
    </Box>
  );
}
