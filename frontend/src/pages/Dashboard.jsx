import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { changePasswordRequest } from '../lib/api';
import { useState } from 'react';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '';

  const roleColor = {
    admin: '#dc2626',
    referrer: '#2563eb',
    family: '#16a34a',
  }[user?.role] || '#6b7280';

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Kindness is Magic</h1>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </header>

      <main style={styles.main}>
        {/* Welcome card */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Welcome back!</h2>
          <div style={styles.userInfo}>
            <div style={styles.avatar}>
              {user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <div style={styles.email}>{user?.email}</div>
              <span style={{ ...styles.roleBadge, background: roleColor }}>{roleLabel}</span>
            </div>
          </div>
          {user?.referrer_id && (
            <p style={styles.detail}>Referrer ID: {user.referrer_id}</p>
          )}
          {user?.family_id && (
            <p style={styles.detail}>Family ID: {user.family_id}</p>
          )}
        </div>

        {/* Navigation cards */}
        <div style={styles.navGrid}>
          {user?.role === 'admin' && (
            <>
              <Link to="/register" style={styles.navCard}>
                <div style={styles.navIcon}>👤</div>
                <div style={styles.navLabel}>Register Users</div>
                <div style={styles.navDesc}>Create new referrer or family accounts</div>
              </Link>
              <Link to="/admin/referrers" style={styles.navCard}>
                <div style={styles.navIcon}>👥</div>
                <div style={styles.navLabel}>Manage Referrers</div>
                <div style={styles.navDesc}>Create, edit, and delete referrers</div>
              </Link>
              <Link to="/admin/families" style={styles.navCard}>
                <div style={styles.navIcon}>🏠</div>
                <div style={styles.navLabel}>Manage Families</div>
                <div style={styles.navDesc}>Create, edit, and delete families</div>
              </Link>
              <Link to="/admin/people" style={styles.navCard}>
                <div style={styles.navIcon}>✨</div>
                <div style={styles.navLabel}>Manage People</div>
                <div style={styles.navDesc}>Create, edit, and delete people</div>
              </Link>
              <Link to="/admin/csv-upload" style={styles.navCard}>
                <div style={styles.navIcon}>📊</div>
                <div style={styles.navLabel}>CSV Import</div>
                <div style={styles.navDesc}>Bulk-import referrers, families, people &amp; users</div>
              </Link>
            </>
          )}

          {user?.role === 'referrer' && (
            <>
              <Link to="/referrer/dashboard" style={styles.navCard}>
                <div style={styles.navIcon}>🏠</div>
                <div style={styles.navLabel}>My Families</div>
                <div style={styles.navDesc}>Manage your families and their members</div>
              </Link>
            </>
          )}

          {user?.role === 'family' && (
            <>
              <Link to="/family/dashboard" style={styles.navCard}>
                <div style={styles.navIcon}>✨</div>
                <div style={styles.navLabel}>My Family</div>
                <div style={styles.navDesc}>View your profile and manage people</div>
              </Link>
            </>
          )}
        </div>

        {/* Change password section */}
        <ChangePasswordSection />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ChangePasswordSection (inline sub-component)                        */
/* ------------------------------------------------------------------ */
function ChangePasswordSection() {
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    if (newPass !== confirmPass) {
      setMessage('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await changePasswordRequest(oldPass, newPass);
      setMessage('Password updated successfully!');
      setOldPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err) {
      setMessage(err.response?.data?.detail || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Change Password</h2>
      {message && (
        <div style={{
          ...styles.message,
          color: message.includes('success') ? '#16a34a' : '#dc2626',
          background: message.includes('success') ? '#f0fdf4' : '#fef2f2',
        }}>
          {message}
        </div>
      )}
      <form onSubmit={handleSubmit} style={styles.passForm}>
        <input
          type="password"
          placeholder="Current password"
          value={oldPass}
          onChange={(e) => setOldPass(e.target.value)}
          required
          style={styles.input}
        />
        <input
          type="password"
          placeholder="New password (min 8)"
          value={newPass}
          onChange={(e) => setNewPass(e.target.value)}
          required
          minLength={8}
          style={styles.input}
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirmPass}
          onChange={(e) => setConfirmPass(e.target.value)}
          required
          minLength={8}
          style={styles.input}
        />
        <button type="submit" disabled={loading} style={styles.updateBtn}>
          {loading ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */
const styles = {
  container: {
    minHeight: '100vh',
    background: '#f1f5f9',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    background: 'linear-gradient(135deg, #4c1d95, #6d28d9)',
    color: '#fff',
    padding: '1rem 2rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { margin: 0, fontSize: '1.25rem' },
  logoutBtn: {
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff',
    padding: '0.45rem 1rem',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '0.875rem',
  },
  main: {
    maxWidth: 800,
    margin: '2rem auto',
    padding: '0 1rem',
  },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardTitle: { margin: '0 0 1rem', fontSize: '1.15rem', color: '#1e1b4b' },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '0.75rem',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.25rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  email: { fontSize: '1rem', fontWeight: 600, color: '#1e1b4b' },
  roleBadge: {
    display: 'inline-block',
    color: '#fff',
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.15rem 0.6rem',
    borderRadius: 999,
    marginLeft: '0.5rem',
    verticalAlign: 'middle',
    textTransform: 'uppercase',
  },
  detail: { fontSize: '0.875rem', color: '#6b7280', margin: '0.25rem 0' },
  navGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  navCard: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.25rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  navIcon: { fontSize: '1.75rem', marginBottom: '0.5rem' },
  navLabel: { fontWeight: 600, fontSize: '0.95rem', color: '#1e1b4b' },
  navDesc: { fontSize: '0.8rem', color: '#9ca3af', marginTop: '0.25rem' },
  passForm: { display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 320 },
  input: {
    padding: '0.6rem 0.8rem',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: '0.9rem',
    outline: 'none',
  },
  updateBtn: {
    alignSelf: 'flex-start',
    padding: '0.5rem 1.2rem',
    borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '0.25rem',
  },
  message: { padding: '0.5rem 0.8rem', borderRadius: 8, fontSize: '0.85rem', marginBottom: '0.75rem' },
};
