import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api';
import { Spinner, Button } from '../components/ui';
import AuthTicket from '../components/AuthTicket';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('error');
      setMessage('Missing verification token.');
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('success'))
      .catch((err) => {
        setState('error');
        setMessage(err.response?.data?.error?.message || 'Verification failed.');
      });
  }, [params]);

  return (
    <AuthTicket title="Email verification">
      <div style={{ marginTop: 20, minHeight: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {state === 'verifying' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 14 }}>
            <Spinner /> Verifying…
          </span>
        )}
        {state === 'success' && (
          <div>
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
              ✓ Your email has been verified
            </div>
            <div style={{ marginTop: 20 }}>
              <Button to="/login" variant="primary">
                Sign in
              </Button>
            </div>
          </div>
        )}
        {state === 'error' && (
          <div>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--danger-soft)',
                color: 'var(--danger)',
                fontSize: 13,
              }}
            >
              {message}
            </div>
            <div style={{ marginTop: 16 }}>
              <Link to="/login">Back to login</Link>
            </div>
          </div>
        )}
      </div>
    </AuthTicket>
  );
}
