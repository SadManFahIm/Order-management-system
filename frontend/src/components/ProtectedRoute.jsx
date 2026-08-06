import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();

  // While the stored token is being validated against the server, show a
  // minimal loading state instead of flashing the login page.
  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
        Loading…
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;
  return children;
}
