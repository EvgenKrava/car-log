import type { ReactNode } from 'react';
import { Box, Chip, Divider, Link, Stack, Typography } from '@mui/material';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessageView, ChatAttachmentView } from '@carlog/contracts';

// Map GitHub-flavored markdown to the app's MUI typography so Claude's replies (lists,
// bold, headings, the odd code span) render cleanly instead of as raw `- ` / `**…**`.
const md = {
  p: ({ children }: { children?: ReactNode }) => (
    <Typography variant="body2" sx={{ lineHeight: 1.6, my: 0.75, '&:first-of-type': { mt: 0 }, '&:last-child': { mb: 0 } }}>{children}</Typography>
  ),
  strong: ({ children }: { children?: ReactNode }) => <Box component="strong" sx={{ fontWeight: 700 }}>{children}</Box>,
  em: ({ children }: { children?: ReactNode }) => <Box component="em">{children}</Box>,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover">{children}</Link>
  ),
  ul: ({ children }: { children?: ReactNode }) => <Box component="ul" sx={{ my: 0.75, pl: 2.5 }}>{children}</Box>,
  ol: ({ children }: { children?: ReactNode }) => <Box component="ol" sx={{ my: 0.75, pl: 2.5 }}>{children}</Box>,
  li: ({ children }: { children?: ReactNode }) => (
    <Typography component="li" variant="body2" sx={{ lineHeight: 1.55, mb: 0.25 }}>{children}</Typography>
  ),
  h1: ({ children }: { children?: ReactNode }) => <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>{children}</Typography>,
  h2: ({ children }: { children?: ReactNode }) => <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>{children}</Typography>,
  h3: ({ children }: { children?: ReactNode }) => <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>{children}</Typography>,
  blockquote: ({ children }: { children?: ReactNode }) => (
    <Box sx={{ borderLeft: 3, borderColor: 'divider', pl: 1.5, my: 0.75, color: 'text.secondary' }}>{children}</Box>
  ),
  hr: () => <Divider sx={{ my: 1 }} />,
  pre: ({ children }: { children?: ReactNode }) => (
    <Box component="pre" sx={{
      my: 1, p: 1.25, borderRadius: 1.5, overflowX: 'auto', fontSize: 12,
      bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'grey.100'),
    }}>{children}</Box>
  ),
  code: ({ className, children }: { className?: string; children?: ReactNode }) => (
    <Box component="code" sx={{
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.85em',
      ...(className ? {} : {
        px: 0.5, py: 0.15, borderRadius: 0.5,
        bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(16,24,40,0.06)'),
      }),
    }}>{children}</Box>
  ),
};

function AttachmentView({ a }: { a: ChatAttachmentView }) {
  if (a.contentType === 'application/pdf') {
    return (
      <Chip icon={<InsertDriveFileOutlinedIcon />} label={a.filename ?? 'PDF'}
        component="a" href={a.url} target="_blank" clickable variant="outlined" size="small" sx={{ maxWidth: 240 }} />
    );
  }
  return (
    <Box component="a" href={a.url} target="_blank" sx={{ display: 'block', lineHeight: 0 }}>
      <Box component="img" src={a.url} alt={a.filename ?? ''} loading="lazy"
        sx={{ maxWidth: 240, maxHeight: 220, borderRadius: 2, border: 1, borderColor: 'divider' }} />
    </Box>
  );
}

export function ChatBubble({ role, content, attachments }: ChatMessageView) {
  const attachmentStack = attachments.length > 0 ? (
    <Stack spacing={0.5} sx={{ alignItems: role === 'user' ? 'flex-end' : 'flex-start', mb: content ? 0.75 : 0 }}>
      {attachments.map((a) => <AttachmentView key={a.key} a={a} />)}
    </Stack>
  ) : null;

  // Assistant: avatar + full-width, markdown-rendered text (no heavy bubble).
  if (role === 'assistant') {
    return (
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, mt: 0.25,
          display: 'grid', placeItems: 'center', color: 'primary.main',
          bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(91,91,214,0.18)' : 'rgba(91,91,214,0.10)'),
        }}>
          <SmartToyOutlinedIcon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ minWidth: 0, flexGrow: 1, pt: 0.25 }}>
          {attachmentStack}
          {content ? <Markdown remarkPlugins={[remarkGfm]} components={md}>{content}</Markdown> : null}
        </Box>
      </Stack>
    );
  }

  // User: compact right-aligned bubble; their text is plain (not markdown).
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Box sx={{ maxWidth: '85%' }}>
        {attachmentStack}
        {content ? (
          <Box sx={{
            px: 1.5, py: 1, borderRadius: 2.5, borderTopRightRadius: 0.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            bgcolor: 'primary.main', color: 'primary.contrastText',
          }}>
            <Typography variant="body2" sx={{ lineHeight: 1.5 }}>{content}</Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}