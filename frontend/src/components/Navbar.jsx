import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  return (
    <nav
      style={{
        display: 'flex',
        padding: '8px 16px',
        gap: 16,
        background: '#0f172a',
        color: 'white',
        alignItems: 'center'
      }}
    >
      <span style={{ fontWeight: 'bold' }}>Order System</span>
      <Link to="/products" style={{ color: 'white' }}>
        Products
      </Link>
      <Link to="/promotions" style={{ color: 'white' }}>
        Promotions
      </Link>
      <Link to="/orders" style={{ color: 'white' }}>
        Orders
      </Link>
      <Link to="/orders/new" style={{ color: 'white' }}>
        New Order
      </Link>
      <div style={{ marginLeft: 'auto' }}>
        {user && <span style={{ marginRight: 8 }}>{user.email}</span>}
        <button onClick={logout}>Logout</button>
      </div>
    </nav>
  );
}
