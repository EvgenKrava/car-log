import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Typography,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import GroupIcon from '@mui/icons-material/Group';
import DashboardIcon from '@mui/icons-material/Dashboard';
import { useAuth } from '../../auth';

export function UserMenu() {
  const { t } = useTranslation(['common', 'admin']);
  const { email, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const open = Boolean(anchor);

  const close = () => setAnchor(null);

  return (
    <>
      <IconButton
        color="inherit"
        aria-label={t('common:userMenu')}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <PersonIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={open} onClose={close}>
        {email ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
              {email}
            </Typography>
            <Divider />
          </>
        ) : null}
        <MenuItem
          onClick={() => {
            close();
            navigate('/profile');
          }}
        >
          <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('common:profile')}</ListItemText>
        </MenuItem>
        {isAdmin ? (
          <MenuItem
            onClick={() => {
              close();
              navigate('/admin');
            }}
          >
            <ListItemIcon><DashboardIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('admin:dashboard')}</ListItemText>
          </MenuItem>
        ) : null}
        {isAdmin ? (
          <MenuItem
            onClick={() => {
              close();
              navigate('/admin/users');
            }}
          >
            <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t('common:userManagement')}</ListItemText>
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={() => {
            close();
            void signOut();
          }}
        >
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t('common:signOut')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
