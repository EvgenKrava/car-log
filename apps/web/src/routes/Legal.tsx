import { Container, Link, Paper, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import privacyEn from '../legal/privacy.en.md?raw';
import privacyUk from '../legal/privacy.uk.md?raw';
import termsEn from '../legal/terms.en.md?raw';
import termsUk from '../legal/terms.uk.md?raw';

const DOCS = { privacy: { en: privacyEn, uk: privacyUk }, terms: { en: termsEn, uk: termsUk } } as const;

// Public legal pages, rendered from the markdown sources in ../legal. Language follows
// the app's i18n setting; anything other than Ukrainian falls back to English.
export function Legal({ doc }: { doc: keyof typeof DOCS }) {
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith('uk') ? 'uk' : 'en';
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Markdown
          components={{
            h1: ({ children }) => <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 2 }}>{children}</Typography>,
            h2: ({ children }) => <Typography variant="h6" component="h2" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>{children}</Typography>,
            p: ({ children }) => <Typography sx={{ mb: 1.5 }}>{children}</Typography>,
            li: ({ children }) => <Typography component="li" sx={{ mb: 0.5 }}>{children}</Typography>,
            a: ({ href, children }) => <Link component={RouterLink} to={href ?? '/'}>{children}</Link>,
          }}
        >
          {DOCS[doc][lang]}
        </Markdown>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
          <Link component={RouterLink} to="/">CarLog</Link>
        </Typography>
      </Paper>
    </Container>
  );
}
