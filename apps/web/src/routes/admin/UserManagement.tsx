import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert, Card, CardContent, Chip, Container, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Snackbar, Stack, Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ShieldIcon from '@mui/icons-material/Shield';
import BlockIcon from '@mui/icons-material/Block';
import DeleteIcon from '@mui/icons-material/Delete';
import type { AdminUser } from '@carlog/contracts';
import { useAuth } from '../../auth';
import { useAdminUsers, useSetUserAdmin, useSetUserEnabled, useDeleteUser } from '../../queries';
import { AppShell } from '../../components/ui/AppShell';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusView } from '../../components/ui/StatusView';
import { EmptyState } from '../../components/ui/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatDate } from '../../i18n/format';

type UserCardProps = {
  user: AdminUser;
  isSelf: boolean;
  setAdmin: ReturnType<typeof useSetUserAdmin>;
  setEnabled: ReturnType<typeof useSetUserEnabled>;
  del: ReturnType<typeof useDeleteUser>;
};

function UserCard({ user, isSelf, setAdmin, setEnabled, del }: UserCardProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const close = () => setAnchor(null);

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <div>
            <Typography sx={{ fontWeight: 700 }}>{user.email || user.username}</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              {user.isAdmin ? <Chip size="small" color="primary" icon={<ShieldIcon />} label={t('admin:roleAdmin')} /> : null}
              {!user.enabled ? <Chip size="small" color="warning" label={t('admin:disabled')} /> : null}
              <Chip size="small" variant="outlined" label={user.status} />
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {user.createdAt ? formatDate(user.createdAt, i18n.language) : ''}
            </Typography>
          </div>
          <IconButton size="small" aria-label={t('admin:userActions')} onClick={(e) => setAnchor(e.currentTarget)}>
            <MoreVertIcon />
          </IconButton>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
            <MenuItem onClick={() => { close(); setAdmin.mutate({ username: user.username, makeAdmin: !user.isAdmin }); }}
              disabled={isSelf && user.isAdmin}>
              <ListItemIcon><ShieldIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{user.isAdmin ? t('admin:revokeAdmin') : t('admin:grantAdmin')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { close(); setEnabled.mutate({ username: user.username, enabled: !user.enabled }); }}
              disabled={isSelf && user.enabled}>
              <ListItemIcon><BlockIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{user.enabled ? t('admin:disable') : t('admin:enable')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { close(); setConfirmDelete(true); }} disabled={isSelf} sx={{ color: 'error.main' }}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText>{t('common:delete')}</ListItemText>
            </MenuItem>
          </Menu>
        </Stack>
      </CardContent>
      <ConfirmDialog open={confirmDelete} title={t('admin:deleteTitle')} message={t('admin:deleteConfirm', { email: user.email || user.username })}
        confirmLabel={t('common:delete')} loading={del.isPending}
        onConfirm={async () => { await del.mutateAsync({ username: user.username }); setConfirmDelete(false); }}
        onClose={() => setConfirmDelete(false)} />
    </Card>
  );
}

export function UserManagement() {
  const { t } = useTranslation(['admin']);
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAdminUsers();
  const { email } = useAuth();
  const setAdmin = useSetUserAdmin();
  const setEnabled = useSetUserEnabled();
  const del = useDeleteUser();
  const mutationError = setAdmin.isError || setEnabled.isError || del.isError;
  const closeErrorSnackbar = () => { setAdmin.reset(); setEnabled.reset(); del.reset(); };

  return (
    <AppShell>
      <PageHeader title={t('admin:title')} onBack={() => navigate('/')} />
      <Container maxWidth="sm" sx={{ py: 3 }}>
        {isLoading ? (
          <StatusView state="loading" />
        ) : isError ? (
          <StatusView state="error" message={t('admin:loadError')} />
        ) : !data?.users.length ? (
          <EmptyState title={t('admin:empty')} />
        ) : (
          <Stack spacing={1.5}>
            {data.users.map((u) => (
              <UserCard key={u.username} user={u} isSelf={u.email === email} setAdmin={setAdmin} setEnabled={setEnabled} del={del} />
            ))}
          </Stack>
        )}
      </Container>
      <Snackbar open={mutationError} autoHideDuration={5000} onClose={closeErrorSnackbar}>
        <Alert severity="error" onClose={closeErrorSnackbar}>{t('admin:actionFailed')}</Alert>
      </Snackbar>
    </AppShell>
  );
}
