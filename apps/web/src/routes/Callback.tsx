import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser } from 'aws-amplify/auth';
import { useAuth } from '../auth';

export function Callback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Amplify processes the OAuth redirect on load. Listen for completion, and also
    // poll getCurrentUser as a fallback in case the Hub event fired before mount.
    const stop = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signInWithRedirect') {
        void refresh().then(() => navigate('/', { replace: true }));
      } else if (payload.event === 'signInWithRedirect_failure') {
        setFailed(true);
      }
    });
    void getCurrentUser()
      .then(() => refresh().then(() => navigate('/', { replace: true })))
      .catch(() => { /* not signed in yet; wait for Hub or show failure below */ });
    return () => stop();
  }, [navigate, refresh]);

  useEffect(() => {
    if (failed) navigate('/login', { replace: true });
  }, [failed, navigate]);

  return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}><CircularProgress /></Box>;
}
