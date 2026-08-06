import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState('idle'); // idle | success | error
  const [message, setMessage] = useState('');

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
    try {
      await api.post('/auth/reset-password', { token, password });
      setState('success');
    } catch (err) {
      setState('error');
      setMessage(err.response?.data?.error?.message || 'Reset failed.');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
      <h2>Set a new password</h2>
      {state === 'success' ? (
        <>
          <p style={{ color: '#16a34a' }}>Password updated. Please sign in.</p>
          <Link to="/login">Sign in</Link>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <div>
            <label>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              style={{ width: '100%' }}
            />
          </div>
          {message && <p style={{ color: state === 'error' ? 'red' : '#64748b' }}>{message}</p>}
          <button style={{ marginTop: 12, width: '100%' }}>Reset password</button>
        </form>
      )}
    </div>
  );
}
