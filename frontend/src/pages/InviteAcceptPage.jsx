import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { Field, Input, Button, Badge } from '../components/ui';
import AuthTicket from '../components/AuthTicket';

/**
 * Invite acceptance page (Phase 3 multi-tenant).
 *
 * The invite link carries a raw token. The page previews who/what the invite
 * is for (GET /api/invites/:token), then accepts: a logged-in user whose
 * email matches joins in one click; a logged-out visitor creates an account
 * (name + password) in the same request.
 */
export default function InviteAcceptPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get(`/invites/${token}`)
      .then((res) => mounted && setInfo(res.data))
      .catch((err) => {
        const code = err?.response?.data?.error?.code;
        const msg = {
          INVITE_NOT_FOUND: t('invite.invalid'),
          INVITE_REVOKED: t('invite.revokedMsg'),
          INVITE_EXPIRED: t('invite.expiredMsg'),
          INVITE_ACCEPTED: t('invite.acceptedMsg'),
        }[code];
        setError(msg || t('invite.invalid'));
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const emailMatches = user && info && String(user.email).toLowerCase() === String(info.email).toLowerCase();

  const acceptAsLoggedIn = async () => {
    setBusy(true);
    try {
      await api.post('/invites/accept', { token });
      setDone(true);
      nav('/dashboard');
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      setError(code === 'INVITE_EMAIL_MISMATCH' ? t('invite.mismatch') : t('invite.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const acceptAsNew = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('settings.secMismatch'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.post('/invites/accept', { token, name, password });
      setDone(true);
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      setError(code === 'WEAK_PASSWORD' ? t('invite.policy') : t('invite.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const busyState = () => {
    if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</div>;
    if (error) {
      return (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 10,
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {error}
          <div style={{ marginTop: 12 }}>
            <Link to="/login">{t('invite.signIn')} →</Link>
          </div>
        </div>
      );
    }
    if (done) {
      return (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t('invite.success')}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>{t('invite.successDesc')}</div>
          <Button variant="primary" onClick={() => nav('/login')}>
            {t('invite.signIn')}
          </Button>
        </div>
      );
    }
    return null;
  };

  const formState = () => {
    if (!info || error || done || loading) return null;
    return (
      <>
        <div className="oms-card" style={{ padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>{t('invite.workspace')}:</span>{' '}
              <strong>{info.tenant.name}</strong>
            </span>
            <span>
              <span style={{ color: 'var(--text-muted)' }}>{t('invite.role')}:</span>{' '}
              <Badge tone="primary">{t(`roles.${info.role}`)}</Badge>
            </span>
          </div>
          <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>
            {info.email} · {t('invite.expires')}: {new Date(info.expiresAt).toLocaleDateString()}
          </div>
        </div>

        {emailMatches ? (
          <Button variant="primary" onClick={acceptAsLoggedIn} loading={busy} style={{ width: '100%' }}>
            {busy ? t('invite.accepting') : t('invite.accept')}
          </Button>
        ) : user ? (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {t('invite.mismatch')}
          </div>
        ) : (
          <form onSubmit={acceptAsNew} style={{ display: 'grid', gap: 12 }}>
            <Field label={t('invite.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={info.email.split('@')[0]} />
            </Field>
            <Field label={t('invite.password')} hint={t('invite.policy')}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
            <Field label={t('settings.secConfirm')}>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" variant="primary" loading={busy} disabled={!password}>
              {busy ? t('invite.accepting') : t('invite.accept')}
            </Button>
            <div style={{ textAlign: 'center', fontSize: 13 }}>
              <Link to="/login">{t('auth.signIn')}</Link>
            </div>
          </form>
        )}
      </>
    );
  };

  return (
    <AuthTicket
      title={t('invite.page')}
      desc={`${t('invite.pageDesc')} ${info ? `${t(`roles.${info.role}`)} · ${info.tenant.name}` : ''}`.trim()}
    >
      {busyState()}
      {formState()}
    </AuthTicket>
  );
}
