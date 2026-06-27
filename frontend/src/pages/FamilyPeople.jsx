/**
 * Family People Management
 *
 * List, create, edit, delete people for the current family.
 * Uses shared /api/people/{id} endpoints for individual operations.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  listFamilyPeople,
  createFamilyPerson,
  getPerson,
  updatePerson,
  deletePerson,
} from '../lib/api';

const FAMILY_PEOPLE_KEY = ['familyPeople'];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyPeople() {
  const queryClient = useQueryClient();

  // People list
  const { data, isLoading } = useQuery({
    queryKey: FAMILY_PEOPLE_KEY,
    queryFn: listFamilyPeople,
  });

  // Person detail for edit
  const [editingPersonId, setEditingPersonId] = useState(null);
  const personDetailQuery = useQuery({
    queryKey: ['personDetail', editingPersonId],
    queryFn: () => getPerson(editingPersonId),
    enabled: !!editingPersonId,
  });
  const { data: personDetail } = personDetailQuery;
  const personDetailLoading = !!editingPersonId && personDetailQuery.isLoading;

  // Mutations
  const createMut = useMutation({
    mutationFn: createFamilyPerson,
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_PEOPLE_KEY);
      setShowCreate(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updatePerson(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(FAMILY_PEOPLE_KEY);
      queryClient.invalidateQueries(['personDetail']);
      setEditingPersonId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: deletePerson,
    onSuccess: () => queryClient.invalidateQueries(FAMILY_PEOPLE_KEY),
  });

  // UI state
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleCreate(e) {
    e.preventDefault();
    createMut.mutate(e.data);
  }

  function handleUpdate(e) {
    e.preventDefault();
    if (!editingPersonId) return;
    updateMut.mutate({ id: editingPersonId, data: e.data });
  }

  function openEdit(id) {
    setEditingPersonId(id);
  }

  if (isLoading) return <PageSpinner />;

  const people = data?.people ?? [];

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Kindness is Magic</h1>
        <Link to="/family/dashboard" style={styles.backLink}>← Family Dashboard</Link>
      </header>

      <main style={styles.main}>
        <div style={styles.pageHeader}>
          <h2 style={styles.pageTitle}>Manage People</h2>
          <button
            onClick={() => {
              setEditingPersonId(null);
              setShowCreate(true);
            }}
            style={styles.addBtn}
          >
            + Add Person
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <PersonForm
            title="Add Person"
            initial={defaultPersonForm}
            isEdit={false}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            loading={createMut.isPending}
          />
        )}

        {/* Edit loading */}
        {editingPersonId && personDetailLoading && (
          <div style={styles.detailLoading}>
            <InlineSpinner />
            <span>Loading…</span>
          </div>
        )}

        {/* Edit form */}
        {editingPersonId && personDetail && (
          <PersonForm
            title="Edit Person"
            initial={personDetail}
            isEdit={true}
            onSubmit={handleUpdate}
            onCancel={() => setEditingPersonId(null)}
            loading={updateMut.isPending}
          />
        )}

        {/* Table */}
        <div style={styles.tableWrap}>
          {people.length === 0 ? (
            <p style={styles.empty}>No people yet. Add one to get started.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Age</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td style={styles.td}>{p.id}</td>
                    <td style={styles.td}>{esc(p.given_name)}</td>
                    <td style={styles.td}>{p.age}</td>
                    <td style={styles.td}>
                      <button
                        onClick={() => openEdit(p.id)}
                        style={styles.btnEdit}
                        disabled={!!editingPersonId}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(p.id)}
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
              <p>Delete person <strong>#{deleteConfirm}</strong>?</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => {
                    deleteMut.mutate(deleteConfirm);
                    setDeleteConfirm(null);
                  }}
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
/* PersonForm                                                          */
/* ------------------------------------------------------------------ */
function PersonForm({ title, initial, isEdit, onSubmit, onCancel, loading }) {
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
          Given Name
          <input
            type="text"
            value={form.given_name}
            onChange={(e) => update('given_name', e.target.value)}
            required
            maxLength={40}
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Age
          <input
            type="number"
            value={form.age}
            onChange={(e) => update('age', parseInt(e.target.value) || 0)}
            required
            min={0}
            max={200}
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Title <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
          <input
            type="text"
            value={form.title || ''}
            onChange={(e) => update('title', e.target.value)}
            maxLength={40}
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Practical Wish
          <textarea
            value={form.practical_wish}
            onChange={(e) => update('practical_wish', e.target.value)}
            required
            maxLength={400}
            rows={2}
            style={{ ...styles.input, resize: 'vertical' }}
          />
        </label>

        <label style={styles.label}>
          Fun Wish
          <textarea
            value={form.fun_wish}
            onChange={(e) => update('fun_wish', e.target.value)}
            required
            maxLength={400}
            rows={2}
            style={{ ...styles.input, resize: 'vertical' }}
          />
        </label>

        <label style={styles.label}>
          Note <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span>
          <textarea
            value={form.note || ''}
            onChange={(e) => update('note', e.target.value)}
            maxLength={400}
            rows={2}
            style={{ ...styles.input, resize: 'vertical' }}
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
  );
}

/* ------------------------------------------------------------------ */
/* Spinners                                                            */
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
const defaultPersonForm = {
  given_name: '',
  age: 0,
  title: '',
  practical_wish: '',
  fun_wish: '',
  note: '',
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
  // Buttons
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
