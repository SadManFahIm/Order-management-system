import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setSent(true);
      if (res.data.devToken) setDevLink(`/reset-password?token=${res.data.devToken}`);
    } catch {
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
      <h2>Reset password</h2>
      {sent ? (
        <div style={{ border: '1px solid #cbd5e1', padding: 16, borderRadius: 8 }}>
          <p>{'If that email exists, a reset link has been sent.'}</p>
          {devLink && (
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Development mode: <Link to={devLink}>open the reset link</Link>
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <div>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
          </div>
          {error && <p style={{ color: 'red' }}>{error}</p>}
          <button style={{ marginTop: 12, width: '100%' }}>Send reset link</button>
        </form>
      )}
      <p style={{ textAlign: 'center', marginTop: 16 }}>
        <Link to="/login">Back to login</Link>
      </p>
    </div>
  );
}
