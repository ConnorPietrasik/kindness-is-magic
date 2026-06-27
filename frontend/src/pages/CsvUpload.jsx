/**
 * Admin — CSV Import
 *
 * Upload a CSV file to bulk-import referrers, families, people, and users.
 * Shows a sample template and a drag-and-drop / file picker area.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { adminGetCsvSample, adminImportCsv } from '../lib/api';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function CsvUpload() {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [template, setTemplate] = useState('');
  const [fetchingTemplate, setFetchingTemplate] = useState(false);

  const importMut = useMutation({
    mutationFn: (text) => adminImportCsv(text),
    onSuccess: () => {
      setFile(null);
    },
  });

  function handleFile(inputFile) {
    if (!inputFile) return;
    if (!inputFile.name.toLowerCase().endsWith('.csv')) {
      alert('Please select a .csv file.');
      return;
    }
    setFile(inputFile);
    importMut.reset();
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    handleFile(dropped);
  }

  function handleSelect(e) {
    const selected = e.target.files?.[0];
    handleFile(selected);
  }

  function handleImport() {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      importMut.mutate(e.target.result);
    };
    reader.readAsText(file);
  }

  function fetchTemplate() {
    if (template) {
      setShowTemplate(!showTemplate);
      return;
    }
    setFetchingTemplate(true);
    adminGetCsvSample()
      .then((data) => {
        setTemplate(data.csv_template);
        setShowTemplate(true);
      })
      .catch(() => {
        setTemplate('# Could not load template');
        setShowTemplate(true);
      })
      .finally(() => setFetchingTemplate(false));
  }

  function handleDownloadTemplate() {
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kindness_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>Kindness is Magic</h1>
        <Link to="/dashboard" style={styles.backLink}>← Dashboard</Link>
      </header>

      <main style={styles.main}>
        <div style={styles.pageHeader}>
          <div>
            <h2 style={styles.pageTitle}>CSV Import</h2>
            <p style={styles.pageDesc}>
              Bulk-import referrers, families, people, and users from a single CSV file.
            </p>
          </div>
          <button onClick={fetchTemplate} style={styles.templateBtn}>
            {showTemplate ? 'Hide Template' : '📄 Show Template'}
          </button>
        </div>

        {/* Template preview */}
        {showTemplate && template && (
          <div style={styles.templateCard}>
            <div style={styles.templateHeader}>
              <h3 style={styles.templateTitle}>CSV Template</h3>
              <button onClick={handleDownloadTemplate} style={styles.downloadBtn}>
                ⬇ Download .csv
              </button>
            </div>
            <pre style={styles.templateCode}>{esc(template)}</pre>
          </div>
        )}

        {/* Upload area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            ...styles.dropZone,
            borderColor: dragOver ? '#6366f1' : '#d1d5db',
            background: dragOver ? '#eef2ff' : '#fff',
          }}
        >
          {!file ? (
            <div style={styles.dropContent}>
              <div style={styles.dropIcon}>📁</div>
              <p style={styles.dropText}>
                Drag &amp; drop your CSV file here, or{' '}
                <label style={styles.browseLink}>
                  browse
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleSelect}
                    style={{ display: 'none' }}
                  />
                </label>
              </p>
            </div>
          ) : (
            <div style={styles.fileInfo}>
              <div style={styles.fileIcon}>📄</div>
              <div>
                <strong style={styles.fileName}>{esc(file.name)}</strong>
                <p style={styles.fileSize}>
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button onClick={() => setFile(null)} style={styles.removeBtn}>
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Import button */}
        <div style={styles.actions}>
          <button
            onClick={handleImport}
            disabled={!file || importMut.isPending}
            style={{
              ...styles.importBtn,
              opacity: (!file || importMut.isPending) ? 0.5 : 1,
            }}
          >
            {importMut.isPending ? 'Importing…' : 'Import CSV'}
          </button>
        </div>

        {/* Results */}
        {importMut.data && (
          <ImportResults data={importMut.data} />
        )}

        {/* Error */}
        {importMut.error && (
          <div style={styles.error}>
            {importMut.error?.response?.data?.detail ||
              JSON.stringify(importMut.error?.response?.data) ||
              'Import failed.'}
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results sub-component                                               */
/* ------------------------------------------------------------------ */
function ImportResults({ data }) {
  const { summary, rows } = data;

  function sectionStat(label, s) {
    return (
      <div style={styles.statBox}>
        <div style={styles.statLabel}>{label}</div>
        <div style={styles.statRow}>
          <span style={styles.statGreen}>+{s.created}</span>
          <span style={styles.statYellow} title="Skipped (already exists)">={s.skipped}</span>
          <span style={styles.statRed} title="Errors">×{s.errors}</span>
        </div>
      </div>
    );
  }

  const hasErrors = rows.some((r) => r.action === 'error');

  return (
    <div style={styles.resultsCard}>
      <h3 style={styles.resultsTitle}>Import Results</h3>

      {/* Summary grid */}
      <div style={styles.statsGrid}>
        {sectionStat('Referrers', summary.referrers)}
        {sectionStat('Families', summary.families)}
        {sectionStat('People', summary.people)}
        {sectionStat('Users', summary.users)}
      </div>

      {/* Per-row detail (collapsible) */}
      {rows.length > 0 && (
        <RowDetailTable rows={rows} defaultOpen={hasErrors} />
      )}
    </div>
  );
}

function RowDetailTable({ rows, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  const actionColor = {
    created: '#16a34a',
    skipped: '#d97706',
    error: '#dc2626',
  };

  return (
    <div style={styles.rowDetail}>
      <button
        onClick={() => setOpen(!open)}
        style={styles.toggleBtn}
      >
        {open ? '▾' : '▸'} Row details ({rows.length} rows)
      </button>
      {open && (
        <div style={styles.rowTableWrap}>
          <table style={styles.rowTable}>
            <thead>
              <tr>
                <th style={styles.rowTh}>Row</th>
                <th style={styles.rowTh}>Type</th>
                <th style={styles.rowTh}>Status</th>
                <th style={styles.rowTh}>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={styles.rowTd}>{r.row_number}</td>
                  <td style={styles.rowTd}>{r.entity_type}</td>
                  <td style={{ ...styles.rowTd, color: actionColor[r.action] || '#6b7280', fontWeight: 600 }}>
                    {r.action}
                  </td>
                  <td style={styles.rowTd}>{esc(r.message)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1.5rem',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  pageTitle: { margin: 0, fontSize: '1.4rem', color: '#1e1b4b' },
  pageDesc: { margin: '0.25rem 0 0', fontSize: '0.9rem', color: '#6b7280' },
  templateBtn: {
    padding: '0.45rem 1rem',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    fontSize: '0.875rem',
    cursor: 'pointer',
    color: '#374151',
    whiteSpace: 'nowrap',
  },
  templateCard: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.25rem',
    marginBottom: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  },
  templateHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem',
  },
  templateTitle: { margin: 0, fontSize: '1rem', color: '#1e1b4b' },
  downloadBtn: {
    padding: '0.35rem 0.8rem',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    fontSize: '0.8rem',
    cursor: 'pointer',
    fontWeight: 600,
  },
  templateCode: {
    background: '#f8fafc',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '0.75rem 1rem',
    fontSize: '0.8rem',
    lineHeight: 1.6,
    color: '#374151',
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    maxHeight: 400,
    overflowY: 'auto',
  },
  dropZone: {
    border: '2px dashed',
    borderRadius: 12,
    padding: '2.5rem 1rem',
    textAlign: 'center',
    marginBottom: '1rem',
    transition: 'border-color 0.15s, background 0.15s',
    cursor: 'pointer',
  },
  dropContent: {},
  dropIcon: { fontSize: '2.5rem', marginBottom: '0.5rem' },
  dropText: { margin: 0, fontSize: '0.95rem', color: '#6b7280' },
  browseLink: {
    color: '#6366f1',
    fontWeight: 600,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
  },
  fileIcon: { fontSize: '1.5rem' },
  fileName: { fontSize: '0.95rem', color: '#1e1b4b' },
  fileSize: { margin: 0, fontSize: '0.8rem', color: '#9ca3af' },
  removeBtn: {
    marginLeft: '0.75rem',
    background: 'none',
    border: 'none',
    fontSize: '1rem',
    color: '#dc2626',
    cursor: 'pointer',
    padding: '0.25rem 0.5rem',
    borderRadius: 6,
  },
  actions: { display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' },
  importBtn: {
    padding: '0.6rem 2rem',
    borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '0.75rem 1rem',
    borderRadius: 8,
    fontSize: '0.875rem',
    marginBottom: '1rem',
  },
  // Results
  resultsCard: {
    background: '#fff',
    borderRadius: 12,
    padding: '1.5rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  },
  resultsTitle: { margin: '0 0 1rem', fontSize: '1.1rem', color: '#1e1b4b' },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '0.75rem',
    marginBottom: '1rem',
  },
  statBox: {
    background: '#f8fafc',
    borderRadius: 8,
    padding: '0.75rem 1rem',
    border: '1px solid #e5e7eb',
  },
  statLabel: { fontSize: '0.8rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '0.25rem' },
  statRow: { display: 'flex', gap: '0.75rem', fontSize: '1.1rem', fontWeight: 700 },
  statGreen: { color: '#16a34a' },
  statYellow: { color: '#d97706' },
  statRed: { color: '#dc2626' },
  // Row detail table
  rowDetail: { borderTop: '1px solid #e5e7eb', paddingTop: '0.75rem' },
  toggleBtn: {
    background: 'none',
    border: 'none',
    fontSize: '0.85rem',
    color: '#6366f1',
    cursor: 'pointer',
    fontWeight: 500,
    padding: 0,
    marginBottom: '0.5rem',
  },
  rowTableWrap: { overflowX: 'auto' },
  rowTable: { width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' },
  rowTh: {
    textAlign: 'left',
    padding: '0.4rem 0.6rem',
    borderBottom: '2px solid #e5e7eb',
    fontSize: '0.75rem',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  rowTd: {
    padding: '0.35rem 0.6rem',
    borderBottom: '1px solid #f3f4f6',
    color: '#374151',
  },
};
