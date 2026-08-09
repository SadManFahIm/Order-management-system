import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ProductsPage from './pages/ProductsPage';
import MenuPage from './pages/MenuPage';
import PromotionsPage from './pages/PromotionsPage';
import OrdersListPage from './pages/OrdersListPage';
import NewOrderPage from './pages/NewOrderPage';
import DashboardPage from './pages/DashboardPage';
import PublicMenuPage from './pages/PublicMenuPage';
import LandingPage from './pages/LandingPage';
import SettingsPage from './pages/SettingsPage';
import TableQRPage from './pages/TableQRPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Public storefront menu — no auth; renders from the public API. */}
          <Route path="/m/:slug" element={<PublicMenuPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <div className="oms-shell">
                  <Navbar />
                  <main className="oms-shell__main">
                    <Routes>
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/products" element={<ProductsPage />} />
                      <Route path="/menu" element={<MenuPage />} />
                      <Route path="/promotions" element={<PromotionsPage />} />
                      <Route path="/orders" element={<OrdersListPage />} />
                      <Route path="/orders/new" element={<NewOrderPage />} />
                      <Route path="/tables" element={<TableQRPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                  </main>
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
