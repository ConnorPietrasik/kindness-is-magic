import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordRequest } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await forgotPasswordRequest(email);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Check Your Email</h1>
          <p style={styles.message}>
            If an account exists for <strong>{email}</strong>, a password reset link has been sent.
          </p>
          <p style={styles.devNote}>
            <em>Dev note: Check the backend logs for the reset token.</em>
          </p>
          <Link to="/login" style={styles.link}>← Back to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Forgot Password?</h1>
        <p style={styles.subtitle}>Enter your email and we'll send you a reset link.</p>

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

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Sending…' : 'Send Reset Link'}
          </button>
        </form>

        <p style={styles.footer}>
          <Link to="/login" style={styles.link}>← Back to login</Link>
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
    maxWidth: 420,
    boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
    textAlign: 'center',
  },
  title: { margin: 0, fontSize: '1.5rem', color: '#4c1d95' },
  subtitle: { margin: '0.5rem 0 1.5rem', fontSize: '0.9rem', color: '#6b7280' },
  message: { margin: '0.5rem 0', fontSize: '0.95rem', color: '#374151' },
  devNote: { margin: '1rem 0', fontSize: '0.8rem', color: '#9ca3af', background: '#f9fafb', padding: '0.5rem', borderRadius: 6 },
  error: {
    background: '#fef2f2', color: '#dc2626', padding: '0.6rem 0.8rem',
    borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem',
  },
  label: {
    display: 'flex', flexDirection: 'column', marginBottom: '1rem',
    fontSize: '0.875rem', fontWeight: 500, color: '#374151',
  },
  input: {
    marginTop: '0.35rem', padding: '0.65rem 0.85rem', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: '1rem', outline: 'none',
  },
  button: {
    width: '100%', padding: '0.7rem', borderRadius: 8, border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.5rem',
  },
  footer: { textAlign: 'center', marginTop: '1rem', fontSize: '0.875rem' },
  link: { color: '#6366f1', textDecoration: 'none' },
};
