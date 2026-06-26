import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { registerRequest } from '../lib/api';

const ROLES = [
  { value: 'referrer', label: 'Referrer' },
  { value: 'family', label: 'Family' },
];

export default function Register() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    role: 'referrer',
    referrer_id: '',
    family_id: '',
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const isReferrer = form.role === 'referrer';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email: form.email,
        password: form.password,
        role: form.role,
        referrer_id: isReferrer ? (form.referrer_id ? parseInt(form.referrer_id) : null) : null,
        family_id: !isReferrer ? (form.family_id ? parseInt(form.family_id) : null) : null,
      };

      await registerRequest(payload);
      setSuccess('User created successfully!');
      setForm({
        email: '',
        password: '',
        confirmPassword: '',
        role: 'referrer',
        referrer_id: '',
        family_id: '',
      });
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Register User</h1>
        <p style={styles.subtitle}>Create a new account (admin only)</p>

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              required
              style={styles.input}
              placeholder="user@example.com"
            />
          </label>

          <label style={styles.label}>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
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
              value={form.confirmPassword}
              onChange={(e) => update('confirmPassword', e.target.value)}
              required
              minLength={8}
              style={styles.input}
              placeholder="Re-enter password"
            />
          </label>

          <label style={styles.label}>
            Role
            <select
              value={form.role}
              onChange={(e) => update('role', e.target.value)}
              style={styles.input}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>

          {isReferrer && (
            <label style={styles.label}>
              Referrer ID
              <input
                type="number"
                value={form.referrer_id}
                onChange={(e) => update('referrer_id', e.target.value)}
                required
                style={styles.input}
                placeholder="e.g. 1"
              />
            </label>
          )}

          {!isReferrer && (
            <label style={styles.label}>
              Family ID
              <input
                type="number"
                value={form.family_id}
                onChange={(e) => update('family_id', e.target.value)}
                required
                style={styles.input}
                placeholder="e.g. 1"
              />
            </label>
          )}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Creating…' : 'Create User'}
          </button>
        </form>

        <p style={styles.footer}>
          <Link to="/dashboard" style={styles.link}>← Back to dashboard</Link>
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
  },
  title: { margin: 0, fontSize: '1.5rem', color: '#4c1d95' },
  subtitle: { margin: '0.3rem 0 1.5rem', fontSize: '0.9rem', color: '#6b7280' },
  error: {
    background: '#fef2f2', color: '#dc2626', padding: '0.6rem 0.8rem',
    borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem',
  },
  success: {
    background: '#f0fdf4', color: '#16a34a', padding: '0.6rem 0.8rem',
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
