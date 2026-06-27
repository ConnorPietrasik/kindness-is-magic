/**
 * Referrer Dashboard
 *
 * Shows the referrer's own info, family list with actions,
 * and a card linking to manage each family's people.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getReferrerMe,
  patchReferrerMe,
  listReferrerFamilies,
  createReferrerFamily,
  updateReferrerFamily,
  deleteReferrerFamily,
} from '../lib/api';

const REFERRER_ME_KEY = ['referrerMe'];
const REFERRER_FAMILIES_KEY = ['referrerFamilies'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerDashboard() {
  const queryClient = useQueryClient();

  // Referrer's own info
  const { data: referrerInfo, isLoading: infoLoading } = useQuery({
    queryKey: REFERRER_ME_KEY,
    queryFn: getReferrerMe,
  });

  // Family list
  const { data, isLoading: famLoading } = useQuery({
    queryKey: REFERRER_FAMILIES_KEY,
    queryFn: listReferrerFamilies,
  });

  // Family detail for edit
  const [editingId, setEditingId] = useState(null);

  // Mutations
  const updateSelfMut = useMutation({
    mutationFn: patchReferrerMe,
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_ME_KEY);
      setShowEditSelf(false);
    },
  });

  const createFamMut = useMutation({
    mutationFn: createReferrerFamily,
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_FAMILIES_KEY);
      queryClient.invalidateQueries(REFERRER_ME_KEY);
      setShowCreate(false);
    },
  });

  const updateFamMut = useMutation({
    mutationFn: ({ id, data }) => updateReferrerFamily(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(REFERRER_FAMILIES_KEY);
      setEditingId(null);
    },
  });

  const deleteFamMut = useMutation({
    mutationFn: deleteReferrerFamily,
    onSuccess: () => queryClient.invalidateQueries(REFERRER_FAMILIES_KEY),
  });

  // UI state
  const [showEditSelf, setShowEditSelf] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleUpdateSelf(e) {
    e.preventDefault();
    updateSelfMut.mutate(e.data);
  }

  function handleCreateFam(e) {
    e.preventDefault();
    createFamMut.mutate(e.data);
  }

  function handleUpdateFam(e) {
    e.preventDefault();
    if (!editingId) return;
    updateFamMut.mutate({ id: editingId, data: e.data });
  }

  if (infoLoading || famLoading) return <PageSpinner />;

  const families = data?.families ?? [];
  const familyLimit = referrerInfo?.family_limit ?? 0;
  const familyCount = referrerInfo?.family_count ?? 0;

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Kindness is Magic</h1>
        <Link to="/dashboard" style={styles.backLink}>← Dashboard</Link>
      </header>

      <main style={styles.main}>
        <h2 style={styles.pageTitle}>Referrer Dashboard</h2>

        {/* ── Referrer info card ──────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>My Profile</h3>
            <button
              onClick={() => setShowEditSelf(!showEditSelf)}
              style={styles.btnSmall}
            >
              {showEditSelf ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {showEditSelf ? (
            <ReferrerSelfForm
              initial={referrerInfo ?? defaultReferrerForm}
              onSubmit={handleUpdateSelf}
              onCancel={() => setShowEditSelf(false)}
              loading={updateSelfMut.isPending}
            />
          ) : (
            <div style={styles.infoGrid}>
              <InfoRow label="Name" value={referrerInfo?.name} />
              <InfoRow label="Phone" value={referrerInfo?.phone_number} />
              <InfoRow label="Family Limit" value={`${familyCount} / ${familyLimit}`} />
            </div>
          )}
        </div>

        {/* ── Families ────────────────────────────────────────── */}
        <div style={styles.pageHeader}>
          <h3 style={styles.sectionTitle}>My Families</h3>
          {familyCount < familyLimit && (
            <button
              onClick={() => setShowCreate(true)}
              style={styles.addBtn}
            >
              + Add Family
            </button>
          )}
        </div>

        {showCreate && (
          <FamilyForm
            title="Add Family"
            initial={defaultFamilyForm}
            isEdit={false}
            onSubmit={handleCreateFam}
            onCancel={() => setShowCreate(false)}
            loading={createFamMut.isPending}
          />
        )}

        {editingId && (
          <FamilyForm
            title="Edit Family"
            initial={families.find((f) => f.id === editingId) || defaultFamilyForm}
            isEdit={true}
            onSubmit={handleUpdateFam}
            onCancel={() => setEditingId(null)}
            loading={updateFamMut.isPending}
          />
        )}

        <div style={styles.tableWrap}>
          {families.length === 0 ? (
            <p style={styles.empty}>No families yet. Add one to get started.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Family Name</th>
                  <th style={styles.th}>Contact</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f.id}>
                    <td style={styles.td}>{f.id}</td>
                    <td style={styles.td}>{esc(f.family_name)}</td>
                    <td style={styles.td}>{esc(f.contact_name)}</td>
                    <td style={styles.td}>
                      <Link
                        to={`/referrer/families/${f.id}`}
                        style={styles.btnView}
                      >
                        Manage
                      </Link>
                      <button
                        onClick={() => setEditingId(f.id)}
                        style={styles.btnEdit}
                        disabled={!!editingId}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(f.id)}
                        style={styles.btnDelete}
                        disabled={deleteFamMut.isPending}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Delete confirmation ─────────────────────────────── */}
        {deleteConfirm !== null && (
          <div style={styles.confirmOverlay}>
            <div style={styles.confirmBox}>
              <p>Delete family <strong>#{deleteConfirm}</strong>?</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => {
                    deleteFamMut.mutate(deleteConfirm);
                    setDeleteConfirm(null);
                  }}
                  style={styles.confirmYes}
                  disabled={deleteFamMut.isPending}
                >
                  {deleteFamMut.isPending ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  style={styles.confirmNo}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Errors ──────────────────────────────────────────── */}
        {[updateSelfMut, createFamMut, updateFamMut, deleteFamMut].map(
          (mut, i) =>
            mut.error && (
              <div key={i} style={styles.error}>
                {mut.error?.response?.data?.detail ||
                  mut.error?.response?.data?.msg ||
                  JSON.stringify(mut.error?.response?.data) ||
                  'Request failed.'}
              </div>
            )
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
/* ReferrerSelfForm                                                    */
/* ------------------------------------------------------------------ */
function ReferrerSelfForm({ initial, onSubmit, onCancel, loading }) {
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
        Name
        <input
          type="text"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          required
          maxLength={60}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Phone
        <input
          type="text"
          value={form.phone_number}
          onChange={(e) => update('phone_number', e.target.value)}
          required
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
/* FamilyForm (inline for dashboard)                                   */
/* ------------------------------------------------------------------ */
function FamilyForm({ title, initial, isEdit, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <div style={styles.formOverlay}>
      <h3 style={styles.formTitle}>{title}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ preventDefault: () => {}, data: form });
        }}
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

        {isEdit && (
          <>
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
          </>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </button>
          <button type="button" onClick={onCancel} style={styles.cancelBtn}>
            Cancel
          </button>
        </div>
      </form>
    </div>
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
const defaultReferrerForm = { name: '', family_limit: 1, phone_number: '' };
const defaultFamilyForm = {
  family_name: '',
  family_wish: '',
  contact_name: '',
  bio: '',
  address: '',
  phone_number: '',
};

function esc(s) {
  if (!s) return '';
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
    maxWidth: 900,
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
  infoGrid: { display: 'grid', gap: '0.5rem' },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.4rem 0',
    borderBottom: '1px solid #f3f4f6',
  },
  infoLabel: { fontSize: '0.85rem', color: '#6b7280', fontWeight: 500 },
  infoValue: { fontSize: '0.9rem', color: '#1e1b4b', fontWeight: 600 },
  selfForm: { display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 360 },
  // Section
  sectionTitle: { margin: '0 0 0.5rem', fontSize: '1.1rem', color: '#1e1b4b' },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  addBtn: {
    padding: '0.5rem 1.2rem',
    borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  // Table
  tableWrap: {
    background: '#fff',
    borderRadius: 12,
    padding: '1rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    overflowX: 'auto',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '0.6rem 0.8rem',
    borderBottom: '2px solid #e5e7eb',
    fontSize: '0.8rem',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  td: {
    padding: '0.6rem 0.8rem',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '0.9rem',
    color: '#374151',
  },
  empty: { textAlign: 'center', color: '#9ca3af', padding: '2rem 0' },
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
  btnView: {
    padding: '0.3rem 0.8rem',
    borderRadius: 6,
    border: 'none',
    background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
    color: '#fff',
    fontSize: '0.8rem',
    cursor: 'pointer',
    marginRight: '0.4rem',
    textDecoration: 'none',
    display: 'inline-block',
  },
  btnEdit: {
    padding: '0.3rem 0.8rem',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    fontSize: '0.8rem',
    cursor: 'pointer',
    marginRight: '0.4rem',
    color: '#374151',
  },
  btnDelete: {
    padding: '0.3rem 0.8rem',
    borderRadius: 6,
    border: '1px solid #fca5a5',
    background: '#fff',
    fontSize: '0.8rem',
    cursor: 'pointer',
    color: '#dc2626',
  },
  // Form overlay
  formOverlay: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  },
  formTitle: { margin: '0 0 1rem', fontSize: '1.1rem', color: '#1e1b4b' },
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
  // Confirm
  confirmOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.3)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  confirmBox: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.5rem',
    maxWidth: 400,
    width: '90%',
    boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
  },
  confirmYes: {
    padding: '0.4rem 1rem',
    borderRadius: 8,
    border: 'none',
    background: '#dc2626',
    color: '#fff',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  confirmNo: {
    padding: '0.4rem 1rem',
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
