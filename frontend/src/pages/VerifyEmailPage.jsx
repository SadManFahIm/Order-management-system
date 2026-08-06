import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api';

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
    <div style={{ maxWidth: 400, margin: '80px auto', textAlign: 'center', padding: '0 16px' }}>
      <h2>Email verification</h2>
      {state === 'verifying' && <p style={{ color: '#64748b' }}>Verifying…</p>}
      {state === 'success' && (
        <>
          <p style={{ color: '#16a34a' }}>Your email has been verified!</p>
          <Link to="/login">Sign in</Link>
        </>
      )}
      {state === 'error' && (
        <>
          <p style={{ color: 'red' }}>{message}</p>
          <Link to="/login">Back to login</Link>
        </>
      )}
    </div>
  );
}
