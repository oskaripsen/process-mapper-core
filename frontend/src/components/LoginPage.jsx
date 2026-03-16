import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';

function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(identifier, password);
      } else {
        await register(identifier, username, password);
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
        <p className="auth-subtitle">Use email, username, and password.</p>
        <form onSubmit={submit} className="auth-form">
          <input
            className="auth-input"
            type={mode === 'login' ? 'text' : 'email'}
            placeholder={mode === 'login' ? 'Email or Username' : 'Email'}
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
          {mode === 'register' && (
            <input
              className="auth-input"
              type="text"
              placeholder="Username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="error auth-error"><strong>Error:</strong> {error}</div>}
          <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? 'Working...' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
        <button
          className="btn btn-secondary auth-switch"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Have an account? Login'}
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
