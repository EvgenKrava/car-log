import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Box, Button, Card, CardContent, Container, Snackbar, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import CloudIcon from '@mui/icons-material/Cloud';
import KeyIcon from '@mui/icons-material/Key';
import MemoryIcon from '@mui/icons-material/Memory';
import {
  AnthropicApiKeySchema, type AiModel, type AiProvider, type AiSettings as AiSettingsView,
} from '@carlog/contracts';
import { useAiSettings, useTestAiSettings, useUpdateAiSettings } from '../../queries';
import { AppShell } from '../../components/ui/AppShell';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusView } from '../../components/ui/StatusView';
import { ApiError } from '../../lib/api-error';
import { formatDate } from '../../i18n/format';
import { GARAGE_PATH } from '../../lib/paths';

const PROVIDERS: AiProvider[] = ['anthropic', 'bedrock'];
const MODELS: AiModel[] = ['claude-haiku-5-5', 'claude-haiku-4-5'];

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 0.5 }}>
          <Box
            sx={{
              width: 32, height: 32, borderRadius: 2, display: 'grid', placeItems: 'center', color: 'primary.main',
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(91,91,214,0.16)' : 'rgba(91,91,214,0.08)'),
            }}
          >
            {icon}
          </Box>
          <Typography variant="h6">{title}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{hint}</Typography>
        {children}
      </CardContent>
    </Card>
  );
}

// The form starts from the saved settings; the parent remounts it after each save.
function AiSettingsForm({ saved, onSaved }: { saved: AiSettingsView; onSaved: () => void }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const update = useUpdateAiSettings();
  const test = useTestAiSettings();
  const [provider, setProvider] = useState<AiProvider>(saved.provider);
  const [model, setModel] = useState<AiModel>(saved.model);
  const [editingKey, setEditingKey] = useState(saved.anthropicKey === null);
  const [newKey, setNewKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);

  const trimmed = newKey.trim();
  const keyCheck = trimmed ? AnthropicApiKeySchema.safeParse(trimmed) : null;
  const keyErrorCode = keyCheck && !keyCheck.success ? keyCheck.error.issues[0]?.message : undefined;
  const typedKey = trimmed && !keyErrorCode ? trimmed : undefined;
  const hasKey = Boolean(typedKey) || (saved.anthropicKey !== null && !removeKey);
  // Omitted ⇒ keep, string ⇒ replace, null ⇒ remove (UpdateAiSettingsSchema).
  const keyChange: string | null | undefined = typedKey ?? (removeKey ? null : undefined);
  const dirty = provider !== saved.provider || model !== saved.model || keyChange !== undefined;
  const needsKey = provider === 'anthropic' && !hasKey;
  const canSave = dirty && !keyErrorCode && !needsKey && !update.isPending;
  const canTest = !keyErrorCode && !needsKey && !test.isPending;

  // Any edit makes the last test result stale.
  const edited = <T,>(set: (v: T) => void) => (v: T) => { set(v); test.reset(); update.reset(); };

  const save = () => {
    update.mutate(
      { provider, model, ...(keyChange !== undefined ? { anthropicApiKey: keyChange } : {}) },
      { onSuccess: onSaved },
    );
  };
  const runTest = () => test.mutate({ provider, model, ...(typedKey ? { anthropicApiKey: typedKey } : {}) });

  const saveError = update.error instanceof ApiError
    && (update.error.body as { error?: unknown } | null)?.error === 'NoAnthropicKey'
    ? t('admin:aiNeedsKey')
    : update.isError ? t('admin:actionFailed') : null;

  return (
    <Stack spacing={2}>
      <Section icon={<CloudIcon sx={{ fontSize: 18 }} />} title={t('admin:aiProvider')} hint={t('admin:aiProviderHint')}>
        <ToggleButtonGroup
          exclusive fullWidth size="small" value={provider}
          onChange={(_, v: AiProvider | null) => { if (v) edited(setProvider)(v); }}
          aria-label={t('admin:aiProvider')}
        >
          {PROVIDERS.map((p) => <ToggleButton key={p} value={p}>{t(`admin:aiProvider_${p}`)}</ToggleButton>)}
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t(`admin:aiProviderNote_${provider}`)}
        </Typography>
      </Section>

      <Section icon={<MemoryIcon sx={{ fontSize: 18 }} />} title={t('admin:aiModel')} hint={t('admin:aiModelHint')}>
        <ToggleButtonGroup
          exclusive fullWidth size="small" value={model}
          onChange={(_, v: AiModel | null) => { if (v) edited(setModel)(v); }}
          aria-label={t('admin:aiModel')}
        >
          {MODELS.map((m) => <ToggleButton key={m} value={m}>{t(`admin:aiModel_${m}`)}</ToggleButton>)}
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t(`admin:aiModelNote_${model}`)}
        </Typography>
      </Section>

      <Section icon={<KeyIcon sx={{ fontSize: 18 }} />} title={t('admin:aiKey')} hint={t('admin:aiKeyHint')}>
        {removeKey ? (
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography>{t('admin:aiKeyWillBeRemoved')}</Typography>
            <Button onClick={() => edited(setRemoveKey)(false)}>{t('admin:aiUndo')}</Button>
          </Stack>
        ) : !editingKey && saved.anthropicKey ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'center' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: 'monospace' }}>{`sk-ant-…${saved.anthropicKey.hint}`}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('admin:aiKeyAdded', { date: formatDate(saved.anthropicKey.setAt, i18n.language) })}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button onClick={() => { setEditingKey(true); test.reset(); }}>{t('admin:aiKeyReplace')}</Button>
              <Button color="error" onClick={() => edited(setRemoveKey)(true)}>{t('common:delete')}</Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1}>
            <TextField
              type="password" fullWidth size="small" autoComplete="off" spellCheck={false}
              label={t('admin:aiKeyLabel')} placeholder="sk-ant-api03-…"
              value={newKey} onChange={(e) => edited(setNewKey)(e.target.value)}
              error={Boolean(keyErrorCode)}
              helperText={keyErrorCode ? t(`admin:aiKeyError_${keyErrorCode}`) : t('admin:aiKeyWhere')}
            />
            {saved.anthropicKey ? (
              <Box>
                <Button onClick={() => { setEditingKey(false); edited(setNewKey)(''); }}>{t('common:cancel')}</Button>
              </Box>
            ) : null}
          </Stack>
        )}
      </Section>

      {needsKey ? <Alert severity="info">{t('admin:aiNeedsKey')}</Alert> : null}

      {test.data ? (
        test.data.ok ? (
          <Alert severity="success">{t('admin:aiTestOk', { ms: test.data.latencyMs })}</Alert>
        ) : (
          <Alert severity="error">
            {t(`admin:aiTestError_${test.data.error ?? 'UNAVAILABLE'}`)}
            {test.data.detail ? (
              <Typography variant="caption" component="div" sx={{ mt: 0.5, wordBreak: 'break-word' }}>{test.data.detail}</Typography>
            ) : null}
          </Alert>
        )
      ) : test.isError ? <Alert severity="error">{t('admin:actionFailed')}</Alert> : null}

      {saveError ? <Alert severity="error">{saveError}</Alert> : null}

      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button variant="outlined" onClick={runTest} disabled={!canTest}>
          {test.isPending ? t('admin:aiTesting') : t('admin:aiTest')}
        </Button>
        <Button variant="contained" onClick={save} disabled={!canSave}>
          {update.isPending ? t('admin:aiSaving') : t('common:save')}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {saved.updatedAt
          ? t('admin:aiAppliesTo', { date: formatDate(saved.updatedAt, i18n.language) })
          : t('admin:aiAppliesToDefault')}
      </Typography>
    </Stack>
  );
}

export function AiSettings() {
  const { t } = useTranslation(['admin']);
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAiSettings();
  const [savedNotice, setSavedNotice] = useState(false);

  return (
    <AppShell>
      <PageHeader title={t('admin:aiTitle')} onBack={() => navigate(GARAGE_PATH)} />
      <Container maxWidth="sm" sx={{ py: 3 }}>
        {isLoading ? (
          <StatusView state="loading" />
        ) : isError || !data ? (
          <StatusView state="error" message={t('admin:aiLoadError')} />
        ) : (
          <AiSettingsForm key={data.updatedAt ?? 'initial'} saved={data} onSaved={() => setSavedNotice(true)} />
        )}
      </Container>
      <Snackbar open={savedNotice} autoHideDuration={5000} onClose={() => setSavedNotice(false)}>
        <Alert severity="success" onClose={() => setSavedNotice(false)}>{t('admin:aiSaved')}</Alert>
      </Snackbar>
    </AppShell>
  );
}
