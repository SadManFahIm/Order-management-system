import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';

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
      // In development the API returns the verification token so the flow is
      // usable without a real email provider.
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
    <div style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
      <h2>Create account</h2>
      {devLink ? (
        <div style={{ border: '1px solid #cbd5e1', padding: 16, borderRadius: 8 }}>
          <p>Account created! Check your email for a verification link.</p>
          <p style={{ fontSize: 13, color: '#64748b' }}>
            Development mode:{' '}
            <Link to={devLink}>open the verification link</Link>
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <div>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="8+ chars, letters and numbers"
              style={{ width: '100%' }}
            />
          </div>
          {error && <p style={{ color: 'red' }}>{error}</p>}
          <button style={{ marginTop: 12, width: '100%' }} disabled={submitting}>
            {submitting ? 'Please wait…' : 'Create account'}
          </button>
        </form>
      )}
      <p style={{ textAlign: 'center', marginTop: 16 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
