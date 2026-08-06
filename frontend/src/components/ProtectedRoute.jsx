import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Skeleton, SkeletonText, Logo } from './ui';

export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();

  // While the stored token is being validated against the server, show a
  // skeleton shell instead of flashing the login page.
  if (loading) {
    return (
      <div className="oms-shell">
        <div className="oms-nav">
          <span className="oms-nav__brand">
            <Logo />
          </span>
        </div>
        <div className="oms-page" style={{ maxWidth: 720 }}>
          <Skeleton width={180} height={22} />
          <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
            <div className="oms-card" style={{ padding: 20 }}>
              <SkeletonText lines={4} />
            </div>
            <div className="oms-card" style={{ padding: 20 }}>
              <SkeletonText lines={3} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;
  return children;
}
