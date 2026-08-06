import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api';
import { Logo, Field, Input, Button } from '../components/ui';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState('idle'); // idle | success | error
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    const token = params.get('token');
    if (!token) {
      setState('error');
      setMessage('Missing reset token.');
      return;
    }
    if (password !== confirm) {
      setState('error');
      setMessage('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setState('success');
    } catch (err) {
      setState('error');
      setMessage(err.response?.data?.error?.message || 'Reset failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="oms-auth">
      <div className="oms-auth__card">
        <div className="oms-auth__logo">
          <Logo />
        </div>
        <h1 className="oms-auth__title">Set a new password</h1>
        <p className="oms-auth__desc">Choose a strong password for your account.</p>

        {state === 'success' ? (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderRadius: 8,
                background: 'var(--success-soft)',
                color: 'var(--success)',
                fontSize: 13,
                fontWeight: 550,
              }}
            >
              ✓ Password updated
            </div>
            <div style={{ marginTop: 20 }}>
              <Button to="/login" variant="primary">
                Sign in
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
            <Field label="New password">
              <Input
                type="password"
                id="rp-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm password">
              <Input
                type="password"
                id="rp-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
              />
            </Field>

            {message && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: state === 'error' ? 'var(--danger-soft)' : 'var(--surface-2)',
                  color: state === 'error' ? 'var(--danger)' : 'var(--text-secondary)',
                  fontSize: 13,
                }}
              >
                {message}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" loading={submitting} style={{ width: '100%', marginTop: 16 }}>
              {submitting ? 'Saving…' : 'Reset password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
