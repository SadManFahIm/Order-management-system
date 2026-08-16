import { useEffect, useState } from 'react';
import api, { setAccessToken } from '../api';
import { useI18n } from '../i18n';
import AuthTicket from '../components/AuthTicket';

/**
 * SSO callback landing (Phase 3 enterprise auth).
 *
 * The IdP POSTs the SAMLResponse to the backend ACS, which verifies it and
 * sets the httpOnly refresh cookie, then redirects here. This page calls
 * `/auth/refresh` to turn the cookie into an access token, then does a full
 * reload so AuthProvider boots with the session and the app opens the
 * workspace.
 */
export default function SsoSuccessPage() {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.post('/auth/refresh');
        setAccessToken(res.data.accessToken);
        window.location.assign('/products');
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthTicket title={t('settings.ssoSuccess')} desc={t('settings.ssoSuccessDesc')}>
      <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-muted)', fontSize: 14 }}>
        {failed ? t('settings.ssoFailed') : t('common.loading')}
      </div>
    </AuthTicket>
  );
}
