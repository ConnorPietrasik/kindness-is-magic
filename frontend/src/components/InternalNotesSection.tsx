/**
 * InternalNotesSection — collapsible internal notes editor.
 *
 * Used by both referrer and admin family detail pages. The caller
 * provides the save callback so each context can wire its own API
 * function and query invalidation.
 */

import { useState } from "react";
import { Button } from "./Button";

interface InternalNotesSectionProps {
  /** Current notes value from the server */
  initialNotes: string | null;
  /** Called when the user clicks Save. Sends plain text or empty string to clear. */
  onSave: (notes: string | null) => void;
  /** Whether the save mutation is in-flight */
  isSaving: boolean;
}

export function InternalNotesSection({ initialNotes, onSave, isSaving }: InternalNotesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");

  // Re-sync from server data when collapsed (so we always show fresh data)
  const serverNotes = initialNotes ?? "";
  if (!expanded && notes !== serverNotes) {
    setNotes(serverNotes);
  }

  const handleSave = () => {
    const value = notes.trim() === "" ? "" : notes;
    onSave(value);
  };

  const hasNotes = serverNotes.trim().length > 0;

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <button
        type="button"
        onClick={() => {
          setExpanded((p) => !p);
          if (!expanded) setNotes(serverNotes);
        }}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">📝 Internal Notes</span>
          {hasNotes && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">Set</span>}
        </div>
        <span
          className="text-gray-400 transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
      </button>

      {!expanded && <p className="mt-1 text-xs text-gray-400">Visible only to you and admins</p>}

      {expanded && (
        <div className="mt-3 space-y-2">
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add internal notes…"
            autoComplete="off"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Visible only to you and admins</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{notes.length}/1000</span>
              <Button variant="primary" className="h-7 px-3 text-xs" onClick={handleSave} loading={isSaving}>
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
