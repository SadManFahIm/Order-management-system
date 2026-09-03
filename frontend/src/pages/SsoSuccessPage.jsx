import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import AuthTicket from '../components/AuthTicket';

/**
 * SSO callback landing (Phase 3 enterprise auth).
 *
 * The IdP POSTs the SAMLResponse to the backend ACS, which verifies it and
 * sets the httpOnly refresh cookie, then redirects here. This page does NOT
 * call /auth/refresh itself: AuthProvider's mount bootstrap already probes
 * /auth/me, and the 401 interceptor performs exactly one cookie rotation to
 * restore the session. A second concurrent refresh here would race that
 * rotation and trip the backend's reuse detection (revoking the family).
 * Once the bootstrap resolves, the app simply opens the workspace.
 */
export default function SsoSuccessPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) nav('/products', { replace: true });
  }, [user, loading, nav]);

  // Bootstrap finished with no session — the ACS did not establish a cookie
  // (failed assertion, expired flow, etc.).
  const failed = !loading && !user;

  return (
    <AuthTicket title={t('settings.ssoSuccess')} desc={t('settings.ssoSuccessDesc')}>
      <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-muted)', fontSize: 14 }}>
        {failed ? t('settings.ssoFailed') : t('common.loading')}
      </div>
    </AuthTicket>
  );
}
