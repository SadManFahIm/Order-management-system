import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';
import { Logo, Field, Input, Button, Card } from '../components/ui';

export default function RegisterPage() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [devLink, setDevLink] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/auth/register', { name, email, password });
      if (res.data.devToken) {
        setDevLink(`/verify-email?token=${res.data.devToken}`);
      } else {
        nav('/login');
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Registration failed');
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
        <h1 className="oms-auth__title">Create your account</h1>
        <p className="oms-auth__desc">Start managing orders in minutes.</p>

        {devLink ? (
          <Card bodyPadding={false} style={{ marginTop: 24 }}>
            <div style={{ padding: '20px 22px' }}>
              <p style={{ color: 'var(--text)', fontWeight: 550 }}>Account created!</p>
              <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                Check your email for a verification link.
              </p>
              <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                Development mode: <Link to={devLink}>open the verification link</Link>
              </p>
            </div>
          </Card>
        ) : (
          <form onSubmit={onSubmit} style={{ marginTop: 24 }}>
            <Field label="Name">
              <Input id="reg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required autoComplete="name" />
            </Field>
            <Field label="Email">
              <Input type="email" id="reg-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com" required autoComplete="email" />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <Input
                type="password"
                id="reg-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
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

            <Button type="submit" variant="primary" size="lg" loading={submitting} style={{ width: '100%', marginTop: 16 }}>
              {submitting ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        )}

        <div className="oms-auth__footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
