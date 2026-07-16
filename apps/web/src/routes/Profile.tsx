import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Avatar, Box, Button, Card, CardContent, Container, Stack, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import TuneIcon from '@mui/icons-material/Tune';
import InstallMobileIcon from '@mui/icons-material/InstallMobile';
import VerifiedIcon from '@mui/icons-material/Verified';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../auth';
import { AppShell } from '../components/ui/AppShell';
import { PageHeader } from '../components/ui/PageHeader';
import { useThemeMode, type ThemeMode } from '../lib/theme-mode';

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

// Section header inside a card: small icon in a tinted square + title, echoing
// the vehicle hero's stat-tile language so the app reads as one system.
function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          color: 'primary.main',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)',
        }}
      >
        {icon}
      </Box>
      <Typography variant="h6">{title}</Typography>
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
  const { email, signOut } = useAuth();
  const navigate = useNavigate();
  const { mode, setMode } = useThemeMode();
  const lang: 'en' | 'uk' = i18n.language.startsWith('uk') ? 'uk' : 'en';
  const initial = (email?.[0] ?? '?').toUpperCase();

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
        <Stack spacing={2}>
          {/* Identity hero — same accent-wash treatment as the vehicle hero. */}
          <Card sx={{ overflow: 'hidden' }}>
            <Box
              sx={{
                background: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'linear-gradient(135deg, rgba(91,91,214,0.20) 0%, rgba(91,91,214,0.05) 55%, transparent 100%)'
                    : 'linear-gradient(135deg, rgba(91,91,214,0.10) 0%, rgba(91,91,214,0.03) 55%, transparent 100%)',
              }}
            >
              <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Avatar
                    sx={{
                      width: 64,
                      height: 64,
                      fontSize: 26,
                      fontWeight: 700,
                      bgcolor: 'primary.main',
                    }}
                  >
                    {initial}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h5" noWrap sx={{ wordBreak: 'break-all' }}>
                      {email ?? '—'}
                    </Typography>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5, color: 'text.secondary' }}>
                      <VerifiedIcon sx={{ fontSize: 16 }} color="primary" />
                      <Typography variant="body2">{t('common:account')}</Typography>
                    </Stack>
                  </Box>
                </Stack>
              </CardContent>
            </Box>
          </Card>

          <Card>
            <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
              <SectionTitle icon={<TuneIcon sx={{ fontSize: 18 }} />} title={t('common:settings')} />

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

          <Card>
            <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
              <SectionTitle icon={<InstallMobileIcon sx={{ fontSize: 18 }} />} title={t('common:app')} />
              <SettingRow
                label={t('common:installApp')}
                control={
                  <Typography sx={{ fontWeight: 500 }}>
                    {isStandalone ? t('common:installed') : t('common:notInstalled')}
                  </Typography>
                }
              />
            </CardContent>
          </Card>

          {/* Sign out gets its own quiet, full-width action instead of hiding
              in the header menu only. */}
          <Button
            color="error"
            variant="outlined"
            startIcon={<LogoutIcon />}
            onClick={() => void signOut()}
            sx={{ alignSelf: { xs: 'stretch', sm: 'center' }, px: 4 }}
          >
            {t('common:signOut')}
          </Button>
        </Stack>
      </Container>
    </AppShell>
  );
}