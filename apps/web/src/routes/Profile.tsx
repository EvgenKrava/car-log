import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Card, CardContent, Container, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import { useAuth } from '../auth';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { useThemeMode, type ThemeMode } from '../lib/theme-mode';

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography sx={{ fontWeight: 500 }}>{value}</Typography>
    </Stack>
  );
}

// A setting row: label on the left, control on the right; stacks on phones so
// the toggle groups never overflow at 360px.
function SettingRow({ label, control }: { label: string; control: React.ReactNode }) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      spacing={1}
      sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0, pb: 0 } }}
    >
      <Typography color="text.secondary">{label}</Typography>
      {control}
    </Stack>
  );
}

const THEME_OPTIONS: { value: ThemeMode; icon: React.ReactNode; labelKey: string }[] = [
  { value: 'system', icon: <SettingsBrightnessIcon sx={{ fontSize: 18 }} />, labelKey: 'common:themeSystem' },
  { value: 'light', icon: <LightModeIcon sx={{ fontSize: 18 }} />, labelKey: 'common:themeLight' },
  { value: 'dark', icon: <DarkModeIcon sx={{ fontSize: 18 }} />, labelKey: 'common:themeDark' },
];

export function Profile() {
  const { t, i18n } = useTranslation(['common']);
  const { email } = useAuth();
  const navigate = useNavigate();
  const { mode, setMode } = useThemeMode();
  const lang: 'en' | 'uk' = i18n.language.startsWith('uk') ? 'uk' : 'en';

  const setLang = (code: 'en' | 'uk') => {
    void i18n.changeLanguage(code);
    document.documentElement.lang = code;
  };

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return (
    <AppShell>
      <PageHeader title={t('common:profile')} onBack={() => navigate('/')} />
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>{t('common:account')}</Typography>
            <SpecRow label="Email" value={email ?? '—'} />
          </CardContent>
        </Card>

        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>{t('common:settings')}</Typography>

            <SettingRow
              label={t('common:theme')}
              control={
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={mode}
                  onChange={(_, v: ThemeMode | null) => { if (v) setMode(v); }}
                  aria-label={t('common:theme')}
                >
                  {THEME_OPTIONS.map((o) => (
                    <ToggleButton key={o.value} value={o.value} sx={{ px: 1.5, gap: 0.75, textTransform: 'none' }}>
                      {o.icon}
                      {t(o.labelKey)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              }
            />

            <SettingRow
              label={t('common:language')}
              control={
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={lang}
                  onChange={(_, v: 'en' | 'uk' | null) => { if (v) setLang(v); }}
                  aria-label={t('common:language')}
                >
                  <ToggleButton value="en" sx={{ px: 2, textTransform: 'none' }}>{t('common:languageEnglish')}</ToggleButton>
                  <ToggleButton value="uk" sx={{ px: 2, textTransform: 'none' }}>{t('common:languageUkrainian')}</ToggleButton>
                </ToggleButtonGroup>
              }
            />
          </CardContent>
        </Card>

        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>{t('common:app')}</Typography>
            <SpecRow
              label={t('common:installApp')}
              value={isStandalone ? t('common:installed') : t('common:notInstalled')}
            />
          </CardContent>
        </Card>
      </Container>
    </AppShell>
  );
}