import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { PageHeader, Card, Field, Input, Button, useToast } from '../components/ui';

/**
 * Change password (Phase 2 hardening) — the landing page for admin-forced
 * resets (mustChangePassword) and the self-service entry point from Settings.
 */
export default function ChangePasswordPage() {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const forced = new URLSearchParams(location.search).get('forced') === '1' || Boolean(user?.mustChangePassword);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const onChange = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError(t('changePassword.mismatch'));
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      toast.success(t('changePassword.updated'));
      nav('/products');
    } catch (err) {
      const message = err?.response?.data?.error?.message;
      if (message?.includes('uppercase')) {
        setError(t('changePassword.policy'));
      } else {
        setError(message || t('changePassword.failed'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="oms-page" style={{ maxWidth: 560 }}>
      <PageHeader
        title={t('changePassword.page')}
        desc={forced ? t('changePassword.forcedDesc') : t('changePassword.pageDesc')}
      />
      <Card>
        {forced && (
          <div
            style={{
              marginBottom: 18,
              padding: '10px 14px',
              borderRadius: 8,
              background: 'var(--warning-soft, #fff8e1)',
              color: 'var(--warning, #b45309)',
              fontSize: 13,
            }}
          >
            {t('changePassword.forcedNotice')}
          </div>
        )}
        <form onSubmit={onChange} style={{ display: 'grid', gap: 16 }}>
          <Field label={t('changePassword.current')}>
            <Input
              type="password"
              id="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </Field>
          <Field label={t('changePassword.new')} hint={t('changePassword.policyHint')}>
            <Input
              type="password"
              id="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('changePassword.confirm')}>
            <Input
              type="password"
              id="confirm-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="new-password"
            />
          </Field>

          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--danger-soft)',
                color: 'var(--danger)',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button type="submit" variant="primary" loading={saving}>
              {saving ? t('common.loading') : t('changePassword.submit')}
            </Button>
            {!forced && (
              <Button type="button" variant="ghost" onClick={() => nav(-1)}>
                {t('common.cancel')}
              </Button>
            )}
          </div>
        </form>
      </Card>

      {forced && (
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Button variant="ghost" onClick={logout}>
            {t('changePassword.signOut')}
          </Button>
        </div>
      )}
    </div>
  );
}
