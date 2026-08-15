import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { Field, Input, Button, Card } from '../components/ui';
import AuthTicket from '../components/AuthTicket';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setSent(true);
      if (res.data.devToken) setDevLink(`/reset-password?token=${res.data.devToken}`);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthTicket
      title="Reset your password"
      desc="We'll email you a secure reset link."
      footer={<Link to="/login">Back to login</Link>}
    >
      {sent ? (
        <Card bodyPadding={false} style={{ marginTop: 20 }}>
          <div style={{ padding: '20px 22px' }}>
            <p style={{ color: 'var(--text)', fontWeight: 550 }}>Check your inbox</p>
            <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              If that email exists, a reset link has been sent.
            </p>
            {devLink && (
              <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                Development mode: <Link to={devLink}>open the reset link</Link>
              </p>
            )}
          </div>
        </Card>
      ) : (
        <form onSubmit={onSubmit} style={{ marginTop: 20 }}>
          <Field label="Email">
            <Input type="email" id="fp-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com" required autoComplete="email" />
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
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthTicket>
  );
}
