import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import ProductsPage from './pages/ProductsPage';
import PromotionsPage from './pages/PromotionsPage';
import OrdersListPage from './pages/OrdersListPage';
import NewOrderPage from './pages/NewOrderPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <div>
                  <Navbar />
                  <Routes>
                    <Route path="/products" element={<ProductsPage />} />
                    <Route path="/promotions" element={<PromotionsPage />} />
                    <Route path="/orders" element={<OrdersListPage />} />
                    <Route path="/orders/new" element={<NewOrderPage />} />
                  </Routes>
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
