import React, { createContext, useContext, useEffect, useState } from 'react';
import api, { setAuthToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(
    () => window.localStorage.getItem('token') || null
  );

  useEffect(() => {
    if (token) setAuthToken(token);
  }, [token]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setUser(res.data.user);
    setToken(res.data.token);
    window.localStorage.setItem('token', res.data.token);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    window.localStorage.removeItem('token');
    setAuthToken(null);
  };

  const value = { user, token, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
