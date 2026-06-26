/**
 * Admin — Manage Families
 *
 * List, create, edit, delete families.
 * Fetches referrers for dropdown and display.
 */

import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  adminListFamilies,
  adminGetFamily,
  adminCreateFamily,
  adminUpdateFamily,
  adminDeleteFamily,
  adminListReferrers,
} from '../lib/api';

const FAMILY_KEYS = ['adminFamilies'];
const REFERRER_KEYS = ['adminReferrers'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilies() {
  const queryClient = useQueryClient();

  // Families list
  const { data, isLoading } = useQuery({
    queryKey: FAMILY_KEYS,
    queryFn: adminListFamilies,
  });

  // Referrers lookup (for dropdown + display)
  const { data: referrerData } = useQuery({
    queryKey: REFERRER_KEYS,
    queryFn: adminListReferrers,
  });

  const referrerMap = useMemo(() => {
    const map = {};
    (referrerData?.referrers ?? []).forEach((r) => {
      map[r.id] = r.name;
    });
    return map;
  }, [referrerData]);

  // Detail for edit
  const [editingId, setEditingId] = useState(null);
  const detailQuery = useQuery({
    queryKey: ['adminFamilyDetail', editingId],
    queryFn: () => adminGetFamily(editingId),
    enabled: !!editingId,
  });
  const { data: detail } = detailQuery;
  const detailLoading = !!editingId && detailQuery.isLoading;


  // Mutations
  const createMut = useMutation({
    mutationFn: adminCreateFamily,
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_KEYS);
      setShowForm(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => adminUpdateFamily(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_KEYS);
      queryClient.invalidateQueries(['adminFamilyDetail']);
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: adminDeleteFamily,
    onSuccess: () => queryClient.invalidateQueries(FAMILY_KEYS),
  });

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleCreate(e) {
    e.preventDefault();
    createMut.mutate(e.data);
  }

  function handleUpdate(e) {
    e.preventDefault();
    if (!editingId) return;
    updateMut.mutate({ id: editingId, data: e.data });
  }

  function openEdit(id) {
    setEditingId(id);
  }

  function confirmDelete(id) {
    setDeleteConfirm(id);
  }

  function executeDelete(id) {
    deleteMut.mutate(id);
    setDeleteConfirm(null);
  }

  if (isLoading) return <PageSpinner />;

  const families = data?.families ?? [];

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Kindness is Magic</h1>
        <Link to="/dashboard" style={styles.backLink}>← Dashboard</Link>
      </header>

      <main style={styles.main}>
        <div style={styles.pageHeader}>
          <h2 style={styles.pageTitle}>Manage Families</h2>
          <button
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
            style={styles.addBtn}
          >
            + Add Family
          </button>
        </div>

        {/* Create / Edit form */}
        {editingId && detailLoading && (
          <div style={styles.detailLoading}>
            <InlineSpinner />
            <span>Loading…</span>
          </div>
        )}

        {(showForm || (editingId && detail)) && (
          <FamilyForm
            title={editingId ? 'Edit Family' : 'Add Family'}
            initial={editingId ? (detail ?? defaultForm) : defaultForm}
            isEdit={!!editingId}
            referrerMap={referrerMap}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={() => {
              setShowForm(false);
              setEditingId(null);
            }}
            loading={createMut.isPending || updateMut.isPending}
          />
        )}

        {/* Table */}
        <div style={styles.tableWrap}>
          {families.length === 0 ? (
            <p style={styles.empty}>No families yet.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Family Name</th>
                  <th style={styles.th}>Contact</th>
                  <th style={styles.th}>Referrer</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {families.map((f) => (
                  <tr key={f.id}>
                    <td style={styles.td}>{f.id}</td>
                    <td style={styles.td}>{esc(f.family_name)}</td>
                    <td style={styles.td}>{esc(f.contact_name)}</td>
                    <td style={styles.td}>{referrerMap[f.referrer_id] || `ID ${f.referrer_id}`}</td>
                    <td style={styles.td}>
                      <button
                        onClick={() => openEdit(f.id)}
                        style={styles.btnEdit}
                        disabled={!!editingId}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => confirmDelete(f.id)}
                        style={styles.btnDelete}
                        disabled={deleteMut.isPending}
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

        {/* Delete confirmation */}
        {deleteConfirm !== null && (
          <div style={styles.confirmOverlay}>
            <div style={styles.confirmBox}>
              <p>Delete family <strong>#{deleteConfirm}</strong>?</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => executeDelete(deleteConfirm)}
                  style={styles.confirmYes}
                  disabled={deleteMut.isPending}
                >
                  {deleteMut.isPending ? 'Deleting…' : 'Yes, delete'}
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

        {/* Errors */}
        {[createMut, updateMut, deleteMut].map((mut, i) =>
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
/* FamilyForm sub-component                                            */
/* ------------------------------------------------------------------ */
function FamilyForm({ title, initial, isEdit, referrerMap, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  // Referrer options for dropdown (create only)
  const referrerOptions = Object.entries(referrerMap);

  return (
    <div style={styles.formOverlay}>
      <div style={styles.formCard}>
        <h3 style={styles.formTitle}>{title}</h3>
        <form onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ preventDefault: () => {}, data: form });
        }}>
          {!isEdit && referrerOptions.length > 0 && (
            <label style={styles.label}>
              Referrer
              <select
                value={form.referrer_id || ''}
                onChange={(e) => update('referrer_id', parseInt(e.target.value))}
                required
                style={styles.input}
              >
                <option value="">Select referrer…</option>
                {referrerOptions.map(([id, name]) => (
                  <option key={id} value={id}>{name} (ID {id})</option>
                ))}
              </select>
            </label>
          )}

          {!isEdit && referrerOptions.length === 0 && (
            <label style={styles.label}>
              Referrer ID
              <input
                type="number"
                value={form.referrer_id ?? ''}
                onChange={(e) => update('referrer_id', e.target.value ? parseInt(e.target.value) : '')}
                required
                min={1}
                style={styles.input}
              />
            </label>
          )}

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
              rows={3}
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
              {loading ? 'Saving…' : isEdit ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={onCancel} style={styles.cancelBtn}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Spinner                                                             */
/* ------------------------------------------------------------------ */
function InlineSpinner() {
  return (
    <svg
      style={{ animation: 'spin 1s linear infinite', width: 20, height: 20, color: '#6366f1', flexShrink: 0 }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

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
const defaultForm = {
  referrer_id: '',
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
    maxWidth: 960,
    margin: '2rem auto',
    padding: '0 1rem',
  },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
  },
  pageTitle: { margin: 0, fontSize: '1.4rem', color: '#1e1b4b' },
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
  empty: { textAlign: 'center', color: '#9ca3af', padding: '2rem 0' },
  detailLoading: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    justifyContent: 'center',
    padding: '1.5rem',
    background: '#fff',
    borderRadius: 12,
    marginBottom: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
    color: '#6366f1',
    fontSize: '0.9rem',
  },
  // Form
  formOverlay: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  },
  formCard: {},
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
