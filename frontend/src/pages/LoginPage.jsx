import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo, Field, Input, Button } from '../components/ui';

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
    <div className="oms-auth">
      <div className="oms-auth__card">
        <div className="oms-auth__logo">
          <Logo />
        </div>
        <h1 className="oms-auth__title">
          {step === '2fa' ? 'Two-factor verification' : 'Welcome back'}
        </h1>
        <p className="oms-auth__desc">
          {step === '2fa'
            ? `Enter the 6-digit code from your authenticator app${twoFactorPending?.email ? ` for ${twoFactorPending.email}` : ''}.`
            : 'Sign in to your workspace to continue.'}
        </p>

        {step === '2fa' && (
          <div className="oms-steps">
            <span className="oms-steps__dot oms-steps__dot--active" />
            <span className="oms-steps__dot" />
          </div>
        )}

        <form onSubmit={step === '2fa' ? onTwoFactor : onSubmit} style={{ marginTop: 24 }}>
          {step === 'credentials' && (
            <>
              <Field label="Email">
                <Input
                  type="email"
                  id="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@restaurant.com"
                  required
                  autoComplete="email"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </Field>
            </>
          )}

          {step === '2fa' && (
            <Field label="6-digit code" hint="Open your authenticator app and enter the code.">
              <Input
                inputMode="numeric"
                id="2fa-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoFocus
                style={{ letterSpacing: 8, fontSize: 18, textAlign: 'center', height: 46 }}
              />
            </Field>
          )}

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 2,
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
            {submitting ? 'Please wait…' : step === '2fa' ? 'Verify' : 'Sign in'}
          </Button>
        </form>

        {step === 'credentials' && (
          <div className="oms-auth__footer">
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
              <Link to="/register">Create account</Link>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
