import React, { createContext, useContext, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('pmc_token') || '');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('pmc_user');
    return raw ? JSON.parse(raw) : null;
  });

  const getToken = async () => token;

  const saveSession = (session) => {
    setToken(session.access_token);
    setUser(session.user);
    localStorage.setItem('pmc_token', session.access_token);
    localStorage.setItem('pmc_user', JSON.stringify(session.user));
  };

  const login = async (email, password) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Login failed');
    }
    saveSession(await res.json());
  };

  const register = async (email, username, password) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Registration failed');
    }
    saveSession(await res.json());
  };

  const logout = () => {
    setToken('');
    setUser(null);
    localStorage.removeItem('pmc_token');
    localStorage.removeItem('pmc_user');
  };

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token),
      getToken,
      login,
      register,
      logout,
    }),
    [user, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
