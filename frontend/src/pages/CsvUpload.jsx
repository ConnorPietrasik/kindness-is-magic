/**
 * Admin — CSV Import
 *
 * Upload a CSV file to bulk-import referrers, families, people, and users.
 * Shows a sample template and a drag-and-drop / file picker area.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminGetCsvSample, adminImportCsv } from '../lib/api';
import { HeaderBar, BackLink } from '../components/HeaderBar';
import { Card } from '../components/Card';
import Button from '../components/Button';
import { ErrorBox } from '../components/ErrorBox';
import { Table, TableHead, TableBody, Th, Tr, Td } from '../components/Table';
import { esc } from '../lib/utils';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function CsvUpload() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [template, setTemplate] = useState('');
  const [fetchingTemplate, setFetchingTemplate] = useState(false);

  const importMut = useMutation({
    mutationFn: (text) => adminImportCsv(text),
    onSuccess: () => {
      setFile(null);
      // Refresh admin list pages so they show newly imported data
      queryClient.invalidateQueries(['adminReferrers']);
      queryClient.invalidateQueries(['adminFamilies']);
      queryClient.invalidateQueries(['adminPeople']);
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
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink />}
      />

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-violet-950">CSV Import</h2>
            <p className="mt-1 text-sm text-gray-500">
              Bulk-import referrers, families, people, and users from a single CSV file.
            </p>
          </div>
          <Button
            variant={showTemplate ? 'secondary' : 'primary'}
            onClick={fetchTemplate}
            loading={fetchingTemplate && !template}
          >
            {showTemplate ? 'Hide Template' : '\u{1F4C4} Show Template'}
          </Button>
        </div>

        {/* Template preview */}
        {showTemplate && template && (
          <Card className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-violet-950">CSV Template</h3>
              <Button variant="primary" className="px-3 py-1.5 text-xs" onClick={handleDownloadTemplate}>
                {'\u2B07'} Download .csv
              </Button>
            </div>
            <pre className="max-h-[400px] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 whitespace-pre-wrap break-words">
              {esc(template)}
            </pre>
          </Card>
        )}

        {/* Upload area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors mb-4 ${
            dragOver
              ? 'border-btn-start bg-indigo-50'
              : 'border-gray-300 bg-white'
          }`}
        >
          {!file ? (
            <div>
              <div className="mb-2 text-4xl">{'\u{1F4C1}'}</div>
              <p className="text-gray-500">
                Drag &amp; drop your CSV file here, or{' '}
                <label className="cursor-pointer font-semibold text-btn-start underline">
                  browse
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleSelect}
                    className="hidden"
                  />
                </label>
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <span className="text-2xl">{'\u{1F4C4}'}</span>
              <div className="text-left">
                <strong className="block text-base text-violet-950">{esc(file.name)}</strong>
                <span className="text-xs text-gray-400">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <button
                onClick={() => setFile(null)}
                className="ml-2 rounded-md p-1 text-red-600 hover:bg-red-50"
              >
                {'\u2715'}
              </button>
            </div>
          )}
        </div>

        {/* Import button */}
        <div className="mb-6 flex justify-center">
          <Button
            onClick={handleImport}
            disabled={!file || importMut.isPending}
            loading={importMut.isPending}
            className={!file ? 'opacity-50' : ''}
          >
            {importMut.isPending ? 'Importing\u2026' : 'Import CSV'}
          </Button>
        </div>

        {/* Results */}
        {importMut.data && (
          <ImportResults data={importMut.data} />
        )}

        {/* Error */}
        {importMut.error && (
          <ErrorBox
            message={
              importMut.error?.response?.data?.detail ||
              JSON.stringify(importMut.error?.response?.data) ||
              'Import failed.'
            }
          />
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
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</div>
        <div className="flex gap-3 text-lg font-bold">
          <span className="text-green-600" title="Created">+{s.created}</span>
          <span className="text-amber-600" title="Skipped (already exists)">={s.skipped}</span>
          <span className="text-red-600" title="Errors">{'\u00d7'}{s.errors}</span>
        </div>
      </div>
    );
  }

  const hasErrors = rows.some((r) => r.action === 'error');

  return (
    <Card className="mt-4">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">Import Results</h3>

      {/* Summary grid */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {sectionStat('Referrers', summary.referrers)}
        {sectionStat('Families', summary.families)}
        {sectionStat('People', summary.people)}
        {sectionStat('Users', summary.users)}
      </div>

      {/* Per-row detail (collapsible) */}
      {rows.length > 0 && (
        <RowDetailTable rows={rows} defaultOpen={hasErrors} />
      )}
    </Card>
  );
}

function RowDetailTable({ rows, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  const actionColor = {
    created: 'text-green-600',
    skipped: 'text-amber-600',
    error: 'text-red-600',
  };

  return (
    <div className="border-t border-gray-200 pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="mb-2 text-sm font-medium text-btn-start hover:underline"
      >
        {open ? '\u25BC' : '\u25B6'} Row details ({rows.length} rows)
      </button>
      {open && (
        <Table>
          <TableHead>
            <Th>Row</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th>Message</Th>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <Tr key={i}>
                <Td>{r.row_number}</Td>
                <Td>{r.entity_type}</Td>
                <Td className={`font-semibold ${actionColor[r.action] || 'text-gray-500'}`}>
                  {r.action}
                </Td>
                <Td>{esc(r.message)}</Td>
              </Tr>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
