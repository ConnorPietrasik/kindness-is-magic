import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Kindness is Magic</h1>
        <h2 style={styles.subtitle}>Sign in</h2>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
              placeholder="you@example.com"
            />
          </label>

          <label style={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={styles.input}
              placeholder="••••••••"
            />
          </label>

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={styles.footer}>
          <Link to="/forgot-password" style={styles.link}>Forgot your password?</Link>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */
const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '1rem',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    color: '#4c1d95',
    textAlign: 'center',
  },
  subtitle: {
    margin: '0.5rem 0 1.5rem',
    fontSize: '1.1rem',
    color: '#6b7280',
    textAlign: 'center',
    fontWeight: 400,
  },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '0.6rem 0.8rem',
    borderRadius: 8,
    marginBottom: '1rem',
    fontSize: '0.875rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: '1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    marginTop: '0.35rem',
    padding: '0.65rem 0.85rem',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  button: {
    width: '100%',
    padding: '0.7rem',
    borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
  footer: {
    textAlign: 'center',
    marginTop: '1rem',
    fontSize: '0.875rem',
  },
  link: {
    color: '#6366f1',
    textDecoration: 'none',
  },
};
