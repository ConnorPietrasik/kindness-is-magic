/**
 * Admin — Event Deadlines
 *
 * Settings page: admins create, edit, and delete deadline rows. Rows are
 * inline-edited settings rows with no detail view — the settings-row pattern
 * is simpler than the dialog-based CRUD manager, so this is plain React
 * Query + mutations rather than useCrudManager.
 *
 * Every mutation invalidates both the admin list (`adminDeadlines`) and the
 * global public query (`deadlines`) so display banners update everywhere.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DatePicker } from "../components/DatePicker";
import { FormField } from "../components/FormField";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { adminCreateDeadline, adminDeleteDeadline, adminListDeadlines, adminUpdateDeadline } from "../lib/api";
import { localDateKey } from "../lib/deadlines";
import { adminDeadlines, deadlines as deadlinesKey } from "../lib/queryKeys";
import { normalizeUpdatePayload } from "../lib/utils";
import type { Deadline, DeadlineCreate, DeadlineMode, DeadlineType, DeadlineUpdate } from "../types";

/* ------------------------------------------------------------------ */
/* Type / mode metadata                                                */
/* ------------------------------------------------------------------ */

/** Display metadata for the three deadline types (dropdown labels, default labels, enforced hints). */
const DEADLINE_TYPE_META: Record<DeadlineType, { label: string; enforcedHint: string }> = {
  family_info: {
    label: "Family information",
    enforcedHint: "Enforced auto-submits unsubmitted families to the referrer queue",
  },
  referrer_review: {
    label: "Referrer review",
    enforcedHint: "Enforced auto-promotes submitted families to admin review",
  },
  gift_dropoff: {
    label: "Gift drop-off",
    enforcedHint: "Enforced blocks new gift claims",
  },
};

const DEADLINE_TYPES = Object.keys(DEADLINE_TYPE_META) as DeadlineType[];

const MODE_OPTIONS: { value: DeadlineMode; label: string }[] = [
  { value: "display", label: "Display only" },
  { value: "remind", label: "Reminders (no email yet)" },
  { value: "enforced", label: "Enforced" },
];

const TYPE_BADGE_CLASSES: Record<DeadlineType, string> = {
  family_info: "bg-violet-100 text-violet-800",
  referrer_review: "bg-teal-100 text-teal-800",
  gift_dropoff: "bg-rose-100 text-rose-800",
};

type RowStatus = "undated" | "scheduled" | "past";

const STATUS_META: Record<RowStatus, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "bg-blue-100 text-blue-800" },
  past: { label: "Past due", className: "bg-amber-100 text-amber-800" },
  undated: { label: "Undated", className: "bg-gray-100 text-gray-500" },
};

/** Scheduled when the (draft) due date is today or later; past due otherwise; undated when empty. */
function getRowStatus(dueDate: string): RowStatus {
  if (!dueDate) return "undated";
  return dueDate >= localDateKey(new Date()) ? "scheduled" : "past";
}

/* ------------------------------------------------------------------ */
/* Date-only value helpers (create form's DatePicker)                  */
/* ------------------------------------------------------------------ */

/**
 * The shared DatePicker round-trips values through UTC ISO — a bare
 * date-only string would parse as UTC midnight and render the previous day
 * in western timezones. So the picker is fed a naive local-midnight value
 * (`YYYY-MM-DDT00:00:00`) and the saved due_date is derived from the picker
 * value's *local* date components.
 */
function toPickerValue(dueDate: string): string {
  return dueDate ? `${dueDate}T00:00:00` : "";
}

function fromPickerValue(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminDeadlines() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isLoading } = useQuery({
    queryKey: adminDeadlines,
    queryFn: adminListDeadlines,
  });

  const rows = data?.deadlines ?? [];

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const createMut = useMutation({
    mutationFn: (payload: DeadlineCreate) => adminCreateDeadline(payload),
    onSuccess: () => {
      invalidateDeadlines();
      toast.success("Deadline added");
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DeadlineUpdate }) => adminUpdateDeadline(id, payload),
    onSuccess: () => {
      invalidateDeadlines();
      toast.success("Deadline saved");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDeleteDeadline(id),
    onSuccess: () => {
      invalidateDeadlines();
      toast.success("Deadline deleted");
    },
  });

  // The admin settings list and the global public query that feeds the
  // display banners must stay in sync.
  function invalidateDeadlines() {
    queryClient.invalidateQueries({ queryKey: adminDeadlines });
    queryClient.invalidateQueries({ queryKey: deadlinesKey });
  }

  if (isLoading) return <PageSpinner />;

  const deletingRow = rows.find((row) => row.id === deletingId);

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h2 className="mb-2 text-xl font-bold text-violet-950">Event Deadlines</h2>

        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm text-blue-800">
          A deadline stays in effect through the end of its due date; enforced deadlines take effect at 1:00 AM Pacific on the day after.
          Undated rows are inert, and "Reminders" rows send no email yet — reminder emails are planned.
        </div>

        <CreateDeadlineForm onSubmit={(payload) => createMut.mutate(payload)} loading={createMut.isPending} />

        <div className="mt-6">
          {rows.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-gray-400">No deadlines yet. Add one above.</p>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <Th>Type</Th>
                <Th>Label</Th>
                <Th>Due date</Th>
                <Th>Mode</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <DeadlineRow
                    key={row.id}
                    deadline={row}
                    isSavePending={updateMut.isPending}
                    onSave={(id, payload) => updateMut.mutate({ id, payload })}
                    onRequestDelete={() => setDeletingId(row.id)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <MutationErrors mutations={[createMut, updateMut, deleteMut]} />

        <ConfirmDialog
          open={deletingId != null}
          title={deletingRow ? `Delete the "${deletingRow.label}" deadline?` : "Delete this deadline?"}
          description="Any banner or enforcement from this row stops immediately."
          onConfirm={() => {
            if (deletingId != null) deleteMut.mutate(deletingId);
            setDeletingId(null);
          }}
          onCancel={() => setDeletingId(null)}
          loading={deleteMut.isPending}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create form                                                         */
/* ------------------------------------------------------------------ */

interface CreateDeadlineFormProps {
  onSubmit: (payload: DeadlineCreate) => void;
  loading: boolean;
}

function CreateDeadlineForm({ onSubmit, loading }: CreateDeadlineFormProps) {
  const [type, setType] = useState<DeadlineType>("family_info");
  const [label, setLabel] = useState<string>(DEADLINE_TYPE_META.family_info.label);
  const [dueDate, setDueDate] = useState<string>(""); // date-only local (YYYY-MM-DD), "" = undated
  const [mode, setMode] = useState<DeadlineMode>("display");

  // Switching type pre-fills the label with that type's default label.
  const handleTypeChange = (next: DeadlineType) => {
    setType(next);
    setLabel(DEADLINE_TYPE_META[next].label);
  };

  return (
    <Card>
      <h3 className="mb-4 text-base font-semibold text-gray-900">Add deadline</h3>
      <form
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (!label.trim()) return;
          onSubmit({ type, label, due_date: dueDate, mode });
          // The date is per-row — clear it for the next one, keep type/label/mode.
          setDueDate("");
        }}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <FormField
          label="Type"
          as="select"
          fieldProps={{
            value: type,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => handleTypeChange(e.target.value as DeadlineType),
            autoComplete: "off",
          }}
        >
          {DEADLINE_TYPES.map((t) => (
            <option key={t} value={t}>
              {DEADLINE_TYPE_META[t].label}
            </option>
          ))}
        </FormField>

        <FormField
          label="Label"
          fieldProps={{
            value: label,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value),
            maxLength: 100,
            required: true,
            autoComplete: "off",
          }}
        />

        <DatePicker label="Due date" isOptional value={toPickerValue(dueDate)} onChange={(iso) => setDueDate(fromPickerValue(iso))} />

        <FormField
          label="Mode"
          as="select"
          fieldProps={{
            value: mode,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setMode(e.target.value as DeadlineMode),
            autoComplete: "off",
          }}
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </FormField>

        <div className="sm:col-span-2 lg:col-span-4">
          <p className="mb-3 text-xs text-gray-500">{DEADLINE_TYPE_META[type].enforcedHint}</p>
          <Button type="submit" loading={loading}>
            {loading ? "Adding…" : "Add deadline"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Row (inline edit)                                                   */
/* ------------------------------------------------------------------ */

interface DeadlineRowProps {
  deadline: Deadline;
  isSavePending: boolean;
  onSave: (id: number, payload: DeadlineUpdate) => void;
  onRequestDelete: () => void;
}

function DeadlineRow({ deadline, isSavePending, onSave, onRequestDelete }: DeadlineRowProps) {
  const [label, setLabel] = useState(deadline.label);
  const [dueDate, setDueDate] = useState(deadline.due_date ?? "");
  const [mode, setMode] = useState<DeadlineMode>(deadline.mode);

  // Re-sync the draft when the row changes (e.g. the list refetches after a save).
  useEffect(() => {
    setLabel(deadline.label);
    setDueDate(deadline.due_date ?? "");
    setMode(deadline.mode);
  }, [deadline.label, deadline.due_date, deadline.mode]);

  // Minimal patch payload: only changed fields ("" clears the due date).
  const payload = normalizeUpdatePayload({ label, due_date: dueDate, mode }, deadline);
  const isDirty = Object.keys(payload).length > 0;

  return (
    <Tr>
      <Td className="whitespace-nowrap">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_BADGE_CLASSES[deadline.type]}`}>
          {DEADLINE_TYPE_META[deadline.type].label}
        </span>
      </Td>
      <Td className="min-w-[220px]">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          aria-label={`Label for deadline ${deadline.id}`}
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
        />
      </Td>
      <Td className="whitespace-nowrap">
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label={`Due date for deadline ${deadline.id}`}
          autoComplete="off"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
        />
      </Td>
      <Td className="whitespace-nowrap">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as DeadlineMode)}
          aria-label={`Mode for deadline ${deadline.id}`}
          autoComplete="off"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
        >
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Td>
      <Td className="whitespace-nowrap">
        <StatusBadge status={getRowStatus(dueDate)} />
      </Td>
      <Td>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            disabled={!isDirty || !label.trim() || isSavePending}
            onClick={() => onSave(deadline.id, payload)}
          >
            {isSavePending ? "Saving…" : "Save"}
          </Button>
          <Button variant="danger" className="h-8 px-3 text-xs" onClick={onRequestDelete}>
            Delete
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const meta = STATUS_META[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${meta.className}`}>{meta.label}</span>;
}
