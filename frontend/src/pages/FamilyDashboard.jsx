/**
 * Family Dashboard
 *
 * Shows the family's own info and a quick link to manage people.
 * Family users can edit their own family info and navigate to people management.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getFamilyMe,
  patchFamilyMe,
} from '../lib/api';

const FAMILY_ME_KEY = ['familyMe'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyDashboard() {
  const queryClient = useQueryClient();

  // Family's own info
  const { data: familyInfo, isLoading } = useQuery({
    queryKey: FAMILY_ME_KEY,
    queryFn: getFamilyMe,
  });

  // Mutation
  const updateSelfMut = useMutation({
    mutationFn: patchFamilyMe,
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_ME_KEY);
      setShowEdit(false);
    },
  });

  const [showEdit, setShowEdit] = useState(false);

  function handleUpdateSelf(e) {
    e.preventDefault();
    updateSelfMut.mutate(e.data);
  }

  if (isLoading) return <PageSpinner />;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Kindness is Magic</h1>
        <Link to="/dashboard" style={styles.backLink}>← Dashboard</Link>
      </header>

      <main style={styles.main}>
        <h2 style={styles.pageTitle}>Family Dashboard</h2>

        {/* ── Family info card ──────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>My Family Profile</h3>
            <button
              onClick={() => setShowEdit(!showEdit)}
              style={styles.btnSmall}
            >
              {showEdit ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {showEdit ? (
            <FamilySelfForm
              initial={familyInfo ?? defaultFamilyForm}
              onSubmit={handleUpdateSelf}
              onCancel={() => setShowEdit(false)}
              loading={updateSelfMut.isPending}
            />
          ) : (
            familyInfo && (
              <div style={styles.infoGrid}>
                <InfoRow label="Family Name" value={familyInfo.family_name} />
                <InfoRow label="Contact" value={familyInfo.contact_name} />
                <InfoRow label="Family Wish" value={familyInfo.family_wish} />
                <InfoRow label="Bio" value={familyInfo.bio} />
                <InfoRow label="Address" value={familyInfo.address} />
                <InfoRow label="Phone" value={familyInfo.phone_number} />
                <InfoRow label="People Count" value={familyInfo.person_count ?? 0} />
              </div>
            )
          )}
        </div>

        {/* ── Quick nav cards ───────────────────────────────── */}
        <div style={styles.navGrid}>
          <Link to="/family/people" style={styles.navCard}>
            <div style={styles.navIcon}>✨</div>
            <div style={styles.navLabel}>Manage People</div>
            <div style={styles.navDesc}>Add, edit, and delete family members and their wishes</div>
          </Link>
        </div>

        {/* ── Errors ────────────────────────────────────────── */}
        {updateSelfMut.error && (
          <div style={styles.error}>
            {updateSelfMut.error?.response?.data?.detail ||
              JSON.stringify(updateSelfMut.error?.response?.data) ||
              'Request failed.'}
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* InfoRow                                                             */
/* ------------------------------------------------------------------ */
function InfoRow({ label, value }) {
  return (
    <div style={styles.infoRow}>
      <span style={styles.infoLabel}>{label}</span>
      <span style={styles.infoValue}>{esc(value ?? '—')}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FamilySelfForm                                                      */
/* ------------------------------------------------------------------ */
function FamilySelfForm({ initial, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ preventDefault: () => {}, data: form });
      }}
      style={styles.selfForm}
    >
      <label style={styles.label}>
        Family Name
        <input
          type="text"
          value={form.family_name}
          onChange={(e) => update('family_name', e.target.value)}
          required
          maxLength={40}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Family Wish
        <input
          type="text"
          value={form.family_wish}
          onChange={(e) => update('family_wish', e.target.value)}
          required
          maxLength={400}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Contact Name
        <input
          type="text"
          value={form.contact_name}
          onChange={(e) => update('contact_name', e.target.value)}
          required
          maxLength={40}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Bio <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
        <textarea
          value={form.bio || ''}
          onChange={(e) => update('bio', e.target.value)}
          rows={2}
          style={{ ...styles.input, resize: 'vertical' }}
        />
      </label>

      <label style={styles.label}>
        Address <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
        <input
          type="text"
          value={form.address || ''}
          onChange={(e) => update('address', e.target.value)}
          maxLength={200}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Phone <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
        <input
          type="text"
          value={form.phone_number || ''}
          onChange={(e) => update('phone_number', e.target.value)}
          maxLength={20}
          style={styles.input}
        />
      </label>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="submit" disabled={loading} style={styles.submitBtn}>
          {loading ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} style={styles.cancelBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Spinner                                                             */
/* ------------------------------------------------------------------ */
function PageSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <svg
        style={{ animation: 'spin 1s linear infinite', width: 48, height: 48, color: '#6366f1' }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const defaultFamilyForm = {
  family_name: '',
  family_wish: '',
  contact_name: '',
  bio: '',
  address: '',
  phone_number: '',
};

function esc(s) {
  if (s == null) return '';
  if (typeof s !== 'string') return String(s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  backLink: { color: '#fff', textDecoration: 'none', fontSize: '0.9rem', opacity: 0.85 },
  main: {
    maxWidth: 800,
    margin: '2rem auto',
    padding: '0 1rem',
  },
  pageTitle: { margin: '0 0 1.5rem', fontSize: '1.4rem', color: '#1e1b4b' },
  // Card
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
  },
  cardTitle: { margin: 0, fontSize: '1.1rem', color: '#1e1b4b' },
  infoGrid: { display: 'grid', gap: '0.3rem' },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.4rem 0',
    borderBottom: '1px solid #f3f4f6',
  },
  infoLabel: { fontSize: '0.85rem', color: '#6b7280', fontWeight: 500 },
  infoValue: { fontSize: '0.9rem', color: '#1e1b4b', fontWeight: 600, maxWidth: '60%', textAlign: 'right' },
  selfForm: { display: 'flex', flexDirection: 'column', gap: '0.3rem', maxWidth: 400 },
  // Nav
  navGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  navCard: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
  },
  navIcon: { fontSize: '1.75rem', marginBottom: '0.5rem' },
  navLabel: { fontWeight: 600, fontSize: '0.95rem', color: '#1e1b4b' },
  navDesc: { fontSize: '0.8rem', color: '#9ca3af', marginTop: '0.25rem' },
  // Buttons
  btnSmall: {
    padding: '0.3rem 0.7rem',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    fontSize: '0.8rem',
    cursor: 'pointer',
    color: '#374151',
  },
  // Form
  label: {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: '0.8rem',
    fontSize: '0.85rem',
    fontWeight: 500,
    color: '#374151',
  },
  input: {
    marginTop: '0.3rem',
    padding: '0.55rem 0.75rem',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: '0.9rem',
    outline: 'none',
  },
  submitBtn: {
    padding: '0.5rem 1.2rem',
    borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '0.5rem 1.2rem',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '0.5rem 0.8rem',
    borderRadius: 8,
    marginTop: '0.5rem',
    fontSize: '0.85rem',
  },
};
