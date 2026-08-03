import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Chip, CircularProgress, IconButton, Stack, TextField, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SendIcon from '@mui/icons-material/Send';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import type { ChatMessageView, ChatAttachmentView } from '@carlog/contracts';
import {
  useChatSessions, useChatSession, useCreateChatSession, useDeleteChatSession,
  useRenameChatSession, usePostChatMessage,
} from '../queries';
import { formatDate } from '../i18n/format';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ConfirmDialog';

const MAX_ATTACH = 4;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

function AttachmentView({ a }: { a: ChatAttachmentView }) {
  if (a.contentType === 'application/pdf') {
    return (
      <Chip
        icon={<InsertDriveFileOutlinedIcon />}
        label={a.filename ?? 'PDF'}
        component="a" href={a.url} target="_blank" clickable
        variant="outlined" size="small" sx={{ maxWidth: 200 }}
      />
    );
  }
  return (
    <Box component="a" href={a.url} target="_blank" sx={{ display: 'block', lineHeight: 0 }}>
      <Box component="img" src={a.url} alt={a.filename ?? ''} loading="lazy"
        sx={{ maxWidth: 200, maxHeight: 180, borderRadius: 1.5, border: 1, borderColor: 'divider' }} />
    </Box>
  );
}

function Bubble({ role, content, attachments }: ChatMessageView) {
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

export function ChatPanel({ carId, onBack }: { carId: string; onBack: () => void }) {
  const { t, i18n } = useTranslation(['chat', 'common']);
  const [params, setParams] = useSearchParams();
  const activeSid = params.get('chat') ?? undefined;

  const sessions = useChatSessions(carId);
  const session = useChatSession(carId, activeSid);
  const createSession = useCreateChatSession(carId);
  const deleteSession = useDeleteChatSession(carId);
  const renameSession = useRenameChatSession(carId);
  const post = usePostChatMessage(carId);

  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<{ content: string; names: string[] } | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ sid: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const setActive = (sid: string, replace = false) => {
    const next = new URLSearchParams(params);
    next.set('tab', 'chat');
    next.set('chat', sid);
    setParams(next, { replace });
  };
  const clearActive = () => {
    const next = new URLSearchParams(params);
    next.delete('chat');
    setParams(next, { replace: true });
  };

  // Default to the most-recent session when none is selected; leave empty (new-chat prompt)
  // when the car has no sessions yet.
  useEffect(() => {
    if (!activeSid && sessions.data && sessions.data.length > 0) setActive(sessions.data[0]!.id, true);
  }, [activeSid, sessions.data]);

  // Self-heal a stale ?chat (expired 7-day TTL, deleted elsewhere, or otherwise missing):
  // drop it so the default-session effect re-selects the most recent or an empty surface.
  useEffect(() => {
    if (activeSid && session.isError) clearActive();
  }, [activeSid, session.isError]);

  // Don't let a pending turn / error banner from one session bleed onto another when the
  // user switches sessions mid-send.
  useEffect(() => {
    setPending(null);
    post.reset();
  }, [activeSid]);

  const messages = session.data?.messages ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending, post.isPending]);

  const currentTitle = session.data?.title || t('chat:newChat');

  const onPickFiles = (list: FileList | null) => {
    setAttachError(null);
    if (!list) return;
    const picked = Array.from(list);
    const room = MAX_ATTACH - files.length;
    if (picked.length > room) setAttachError(t('chat:attachTooMany', { max: MAX_ATTACH }));
    setFiles((prev) => [...prev, ...picked.slice(0, Math.max(0, room))]);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && files.length === 0) || post.isPending || createSession.isPending) return;
    let sid = activeSid;
    if (!sid) {
      const s = await createSession.mutateAsync();
      sid = s.id;
      setActive(s.id);
    }
    const sentFiles = files;
    const rawInput = input;
    setPending({ content: text, names: sentFiles.map((f) => f.name) });
    setInput('');
    setFiles([]);
    try {
      await post.mutateAsync({ sid, content: text, files: sentFiles });
    } catch {
      // Restore the draft so the user can retry; the error banner is shown from post.isError.
      setInput(rawInput);
      setFiles(sentFiles);
    } finally {
      setPending(null);
    }
  };

  const startNewChat = async () => {
    setSwitcherOpen(false);
    setInput(''); setFiles([]);
    const s = await createSession.mutateAsync();
    setActive(s.id);
  };

  const onDeleteSession = async (sid: string) => {
    await deleteSession.mutateAsync(sid);
    setDeleting(null);
    if (sid === activeSid) clearActive();
  };

  const suggestions = [t('chat:suggestionSpend'), t('chat:suggestionDue'), t('chat:suggestionSummary')];

  return (
    <Stack sx={{ height: 'calc(100dvh - 220px)', minHeight: 420 }}>
      {/* Chat header: back · session switcher · new chat */}
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <IconButton onClick={onBack} aria-label={t('chat:back')} edge="start"><ArrowBackIcon /></IconButton>
        <Box
          component="button" type="button" onClick={() => setSwitcherOpen(true)}
          sx={{
            flexGrow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5,
            border: 0, bgcolor: 'transparent', cursor: 'pointer', color: 'text.primary', p: 0.5,
          }}
        >
          <Typography noWrap sx={{ fontWeight: 700 }}>{currentTitle}</Typography>
          <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        </Box>
        <IconButton onClick={startNewChat} aria-label={t('chat:newChat')} disabled={createSession.isPending}><AddIcon /></IconButton>
      </Stack>

      {/* Messages */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', py: 1.5 }}>
        {activeSid && session.isLoading ? (
          <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={22} /></Stack>
        ) : messages.length === 0 && !pending ? (
          <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', py: 4, px: 2, color: 'text.secondary' }}>
            <Box sx={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'primary.main',
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)') }}>
              <SmartToyOutlinedIcon />
            </Box>
            <Typography variant="body2">{t('chat:empty')}</Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 1 }}>
              {suggestions.map((s) => (
                <Chip key={s} label={s} variant="outlined" onClick={() => setInput(s)} sx={{ cursor: 'pointer' }} />
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.25}>
            {messages.map((m, i) => <Bubble key={i} {...m} />)}
            {pending ? (
              <Bubble
                role="user" content={pending.content} createdAt=""
                attachments={pending.names.map((n, i) => ({ key: `p${i}`, contentType: 'application/pdf' as const, filename: n, size: 0, url: '#' }))}
              />
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
      {attachError ? <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setAttachError(null)}>{attachError}</Alert> : null}

      {/* Attachment previews */}
      {files.length > 0 ? (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
          {files.map((f, i) => (
            <Chip key={i} label={f.name} onDelete={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              icon={f.type === 'application/pdf' ? <InsertDriveFileOutlinedIcon /> : undefined} size="small" sx={{ maxWidth: 200 }} />
          ))}
        </Stack>
      ) : null}

      {/* Composer */}
      <Box component="form" onSubmit={(e) => { e.preventDefault(); void send(); }}
        sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-end' }}>
        <input ref={fileInputRef} type="file" accept={ACCEPT} multiple hidden
          onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }} />
        <IconButton onClick={() => fileInputRef.current?.click()} aria-label={t('chat:attach')}
          disabled={files.length >= MAX_ATTACH}><AttachFileIcon /></IconButton>
        <TextField
          fullWidth size="small" multiline maxRows={5} value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={t('chat:placeholder')} aria-label={t('chat:placeholder')}
        />
        <IconButton type="submit" color="primary" aria-label={t('chat:send')}
          disabled={(!input.trim() && files.length === 0) || post.isPending}><SendIcon /></IconButton>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', mt: 0.5 }}>
        {t('chat:disclaimer')}
      </Typography>

      {/* Session switcher */}
      <Modal open={switcherOpen} onClose={() => setSwitcherOpen(false)} title={t('chat:switcherTitle')}>
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          <Chip icon={<AddIcon />} label={t('chat:newChat')} onClick={startNewChat} sx={{ alignSelf: 'flex-start', mb: 1, cursor: 'pointer' }} color="primary" variant="outlined" />
          {(sessions.data ?? []).length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{t('chat:noSessions')}</Typography>
          ) : (
            (sessions.data ?? []).map((s) => (
              <Stack key={s.id} direction="row" alignItems="center" spacing={1}
                sx={{ p: 1, borderRadius: 1.5, bgcolor: s.id === activeSid ? 'action.selected' : 'transparent' }}>
                <ChatBubbleOutlineIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
                <Box component="button" type="button"
                  onClick={() => { setActive(s.id); setSwitcherOpen(false); }}
                  sx={{ flexGrow: 1, minWidth: 0, textAlign: 'left', border: 0, bgcolor: 'transparent', cursor: 'pointer', color: 'text.primary', p: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600 }}>{s.title || t('chat:newChat')}</Typography>
                  <Typography variant="caption" color="text.secondary">{formatDate(s.updatedAt, i18n.language)}</Typography>
                </Box>
                <IconButton size="small" aria-label={t('chat:rename')} onClick={() => setRenaming({ sid: s.id, title: s.title })}><EditOutlinedIcon fontSize="small" /></IconButton>
                <IconButton size="small" color="error" aria-label={t('common:delete')} onClick={() => setDeleting(s.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
              </Stack>
            ))
          )}
        </Stack>
      </Modal>

      {/* Rename */}
      <Modal
        open={renaming !== null} onClose={() => setRenaming(null)} title={t('chat:renameTitle')}
        onSubmit={(e) => {
          e.preventDefault();
          if (renaming && renaming.title.trim()) {
            void renameSession.mutateAsync({ sid: renaming.sid, title: renaming.title.trim() });
          }
          setRenaming(null);
        }}
        actions={<IconButton type="submit" color="primary" aria-label={t('common:save')}><SendIcon /></IconButton>}
      >
        <TextField autoFocus fullWidth size="small" value={renaming?.title ?? ''}
          onChange={(e) => setRenaming((r) => (r ? { ...r, title: e.target.value } : r))}
          inputProps={{ maxLength: 120 }} />
      </Modal>

      <ConfirmDialog
        open={deleting !== null} title={t('chat:deleteTitle')} message={t('chat:deleteConfirm')}
        confirmLabel={t('common:delete')} loading={deleteSession.isPending}
        onConfirm={() => deleting && onDeleteSession(deleting)} onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}