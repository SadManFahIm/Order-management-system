import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import { Spinner } from './components/ui';

/**
 * Route-level code splitting (Phase 1 foundation) — every page is its own
 * lazy chunk, so the initial bundle only carries the shell + the page the
 * visitor actually lands on (the heavy charts/invoice/report pages load on
 * demand). A Suspense fallback keeps navigation seamless while a chunk
 * streams in.
 */
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const MenuPage = lazy(() => import('./pages/MenuPage'));
const PromotionsPage = lazy(() => import('./pages/PromotionsPage'));
const OrdersListPage = lazy(() => import('./pages/OrdersListPage'));
const NewOrderPage = lazy(() => import('./pages/NewOrderPage'));
const InvoicePage = lazy(() => import('./pages/InvoicePage'));
const DinerReceiptPage = lazy(() => import('./pages/DinerReceiptPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PublicMenuPage = lazy(() => import('./pages/PublicMenuPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TableQRPage = lazy(() => import('./pages/TableQRPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const TrackOrderPage = lazy(() => import('./pages/TrackOrderPage'));
const AdminAnalyticsPage = lazy(() => import('./pages/AdminAnalyticsPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const InviteAcceptPage = lazy(() => import('./pages/InviteAcceptPage'));

function PageLoader() {
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '60vh',
        color: 'var(--text-muted)',
      }}
    >
      <Spinner />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/accept-invite/:token" element={<InviteAcceptPage />} />
            {/* Public storefront — no auth; renders from the public API. */}
            <Route path="/m/:slug" element={<PublicMenuPage />} />
            <Route path="/m/:slug/checkout" element={<CheckoutPage />} />
            {/* Public customer tracking — no auth; phone-verified lookup. */}
            <Route path="/track" element={<TrackOrderPage />} />
            <Route path="/track/:orderNo" element={<TrackOrderPage />} />
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
                        <Route path="/orders/:id/invoice" element={<InvoicePage />} />
                        <Route path="/orders/:id/split/receipts/:paymentId" element={<DinerReceiptPage />} />
                        <Route path="/tables" element={<TableQRPage />} />
                        <Route path="/reports" element={<ReportsPage />} />
                        <Route path="/admin" element={<AdminAnalyticsPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/change-password" element={<ChangePasswordPage />} />
                      </Routes>
                    </main>
                  </div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
