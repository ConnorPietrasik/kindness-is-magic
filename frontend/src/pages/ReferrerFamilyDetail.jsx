/**
 * Referrer Family Detail
 *
 * View/edit a specific family and manage its people.
 * Accessible from ReferrerDashboard via "Manage" link.
 */

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getReferrerFamily,
  updateReferrerFamily,
  listReferrerFamilyPeople,
  createReferrerFamilyPerson,
  getPerson,
  updatePerson,
  deletePerson,
} from '../lib/api';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerFamilyDetail() {
  const { id: famId } = useParams();
  const famIdNum = parseInt(famId);
  const queryClient = useQueryClient();

  // Family detail
  const { data: family, isLoading: famLoading } = useQuery({
    queryKey: ['referrerFamily', famIdNum],
    queryFn: () => getReferrerFamily(famIdNum),
  });

  // People list
  const { data, isLoading: peopleLoading } = useQuery({
    queryKey: ['referrerFamilyPeople', famIdNum],
    queryFn: () => listReferrerFamilyPeople(famIdNum),
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

  // Family mutations
  const updateFamMut = useMutation({
    mutationFn: ({ id, data }) => updateReferrerFamily(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamily', famIdNum]);
      queryClient.invalidateQueries(['referrerFamilies']);
    },
  });

  // Person mutations
  const createPersonMut = useMutation({
    mutationFn: (data) => createReferrerFamilyPerson(famIdNum, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamilyPeople', famIdNum]);
      queryClient.invalidateQueries(['referrerFamily', famIdNum]);
      setShowCreatePerson(false);
    },
  });

  const updatePersonMut = useMutation({
    mutationFn: ({ id, data }) => updatePerson(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamilyPeople', famIdNum]);
      queryClient.invalidateQueries(['personDetail']);
      setEditingPersonId(null);
    },
  });

  const deletePersonMut = useMutation({
    mutationFn: deletePerson,
    onSuccess: () => {
      queryClient.invalidateQueries(['referrerFamilyPeople', famIdNum]);
      queryClient.invalidateQueries(['referrerFamily', famIdNum]);
    },
  });

  // UI state
  const [showEditFamily, setShowEditFamily] = useState(false);
  const [showCreatePerson, setShowCreatePerson] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  function handleUpdateFam(e) {
    e.preventDefault();
    updateFamMut.mutate({ id: famIdNum, data: e.data });
  }

  function handleCreatePerson(e) {
    e.preventDefault();
    createPersonMut.mutate(e.data);
  }

  function handleUpdatePerson(e) {
    e.preventDefault();
    if (!editingPersonId) return;
    updatePersonMut.mutate({ id: editingPersonId, data: e.data });
  }

  if (famLoading || peopleLoading) return <PageSpinner />;

  const people = data?.people ?? [];

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Kindness is Magic</h1>
        <Link to="/referrer/dashboard" style={styles.backLink}>← My Families</Link>
      </header>

      <main style={styles.main}>
        <h2 style={styles.pageTitle}>Family Detail</h2>

        {/* ── Family info card ──────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>
              {family ? esc(family.family_name) : '—'}
              {family && (
                <span style={styles.personCountBadge}>
                  {family.person_count ?? 0} person{family.person_count !== 1 ? 's' : ''}
                </span>
              )}
            </h3>
            <button
              onClick={() => setShowEditFamily(!showEditFamily)}
              style={styles.btnSmall}
            >
              {showEditFamily ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {showEditFamily ? (
            <FamilyEditForm
              initial={family ?? defaultFamilyForm}
              onSubmit={handleUpdateFam}
              onCancel={() => setShowEditFamily(false)}
              loading={updateFamMut.isPending}
            />
          ) : (
            family && (
              <div style={styles.infoGrid}>
                <InfoRow label="Family Name" value={family.family_name} />
                <InfoRow label="Contact" value={family.contact_name} />
                <InfoRow label="Family Wish" value={family.family_wish} />
                <InfoRow label="Bio" value={family.bio} />
                <InfoRow label="Address" value={family.address} />
                <InfoRow label="Phone" value={family.phone_number} />
              </div>
            )
          )}
        </div>

        {/* ── People section ────────────────────────────────── */}
        <div style={styles.pageHeader}>
          <h3 style={styles.sectionTitle}>People</h3>
          <button
            onClick={() => setShowCreatePerson(true)}
            style={styles.addBtn}
          >
            + Add Person
          </button>
        </div>

        {showCreatePerson && (
          <PersonForm
            title="Add Person"
            initial={defaultPersonForm}
            isEdit={false}
            onSubmit={handleCreatePerson}
            onCancel={() => setShowCreatePerson(false)}
            loading={createPersonMut.isPending}
          />
        )}

        {editingPersonId && personDetailLoading && (
          <div style={styles.detailLoading}>
            <InlineSpinner />
            <span>Loading…</span>
          </div>
        )}

        {editingPersonId && personDetail && (
          <PersonForm
            title="Edit Person"
            initial={personDetail}
            isEdit={true}
            onSubmit={handleUpdatePerson}
            onCancel={() => setEditingPersonId(null)}
            loading={updatePersonMut.isPending}
          />
        )}

        <div style={styles.tableWrap}>
          {people.length === 0 ? (
            <p style={styles.empty}>No people in this family yet.</p>
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
                        onClick={() => setEditingPersonId(p.id)}
                        style={styles.btnEdit}
                        disabled={!!editingPersonId}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(p.id)}
                        style={styles.btnDelete}
                        disabled={deletePersonMut.isPending}
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

        {/* ── Delete confirmation ───────────────────────────── */}
        {deleteConfirm !== null && (
          <div style={styles.confirmOverlay}>
            <div style={styles.confirmBox}>
              <p>Delete person <strong>#{deleteConfirm}</strong>?</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => {
                    deletePersonMut.mutate(deleteConfirm);
                    setDeleteConfirm(null);
                  }}
                  style={styles.confirmYes}
                  disabled={deletePersonMut.isPending}
                >
                  {deletePersonMut.isPending ? 'Deleting…' : 'Yes, delete'}
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

        {/* ── Errors ────────────────────────────────────────── */}
        {[updateFamMut, createPersonMut, updatePersonMut, deletePersonMut].map(
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
/* FamilyEditForm                                                      */
/* ------------------------------------------------------------------ */
function FamilyEditForm({ initial, onSubmit, onCancel, loading }) {
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
const defaultFamilyForm = {
  family_name: '',
  family_wish: '',
  contact_name: '',
  bio: '',
  address: '',
  phone_number: '',
};

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
  personCountBadge: {
    marginLeft: '0.75rem',
    fontSize: '0.75rem',
    color: '#fff',
    background: '#6366f1',
    padding: '0.15rem 0.55rem',
    borderRadius: 999,
    fontWeight: 600,
  },
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
  btnSmall: {
    padding: '0.3rem 0.7rem',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#fff',
    fontSize: '0.8rem',
    cursor: 'pointer',
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
