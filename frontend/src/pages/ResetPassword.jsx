import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { resetPasswordRequest } from '../lib/api';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await resetPasswordRequest(token, newPassword);
      setSuccess(true);

      // Auto-redirect to login after 3 seconds
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Reset failed. The token may be invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>✓ Password Reset!</h1>
          <p style={styles.message}>Your password has been updated. Redirecting to login…</p>
          <Link to="/login" style={styles.link}>Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Reset Password</h1>
        <p style={styles.subtitle}>Enter your new password below.</p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>
            New Password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              style={styles.input}
              placeholder="Min 8 characters"
            />
          </label>

          <label style={styles.label}>
            Confirm Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              style={styles.input}
              placeholder="Re-enter password"
            />
          </label>

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Resetting…' : 'Reset Password'}
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
