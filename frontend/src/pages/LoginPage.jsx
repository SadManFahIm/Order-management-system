import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, verifyTwoFactor, twoFactorPending } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.requiresTwoFactor) {
        setStep('2fa');
      } else {
        nav('/products');
      }
    } catch {
      setError('Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  };

  const onTwoFactor = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await verifyTwoFactor(code);
      nav('/products');
    } catch {
      setError('Invalid verification code');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: '0 16px' }}>
      <h2>{step === '2fa' ? 'Two-factor verification' : 'Sign in'}</h2>
      {step === '2fa' && twoFactorPending && (
        <p style={{ color: '#64748b' }}>
          Enter the 6-digit code from your authenticator app
          {twoFactorPending.email ? ` for ${twoFactorPending.email}` : ''}.
        </p>
      )}
      <form onSubmit={step === '2fa' ? onTwoFactor : onSubmit}>
        {step === 'credentials' && (
          <>
            <div>
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}
        {step === '2fa' && (
          <div>
            <label>6-digit code</label>
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              style={{ width: '100%', letterSpacing: 6, fontSize: 20 }}
            />
          </div>
        )}
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button style={{ marginTop: 12, width: '100%' }} disabled={submitting}>
          {submitting ? 'Please wait…' : step === '2fa' ? 'Verify' : 'Login'}
        </button>
      </form>
      {step === 'credentials' && (
        <div style={{ marginTop: 16, display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Link to="/register">Create account</Link>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
      )}
    </div>
  );
}
