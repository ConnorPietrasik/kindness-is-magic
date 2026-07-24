/**
 * Client-side CSV parsing and validation utilities for the import workflow.
 *
 * These functions mirror the backend's section-based CSV format so we can
 * catch obvious problems before uploading.  Full validation (FK lookups,
 * constraint checks, sanitisation) still happens server-side.
 */

import type { CsvSections, CsvValidationResult } from "../types";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Section names the backend recognises (case-insensitive). */
export const KNOWN_SECTIONS = ["referrers", "families", "people", "users"] as const;

/** Expected header columns per section (lowercase, trimmed). */
export const EXPECTED_HEADERS: Record<(typeof KNOWN_SECTIONS)[number], readonly string[]> = {
  referrers: ["name", "family_limit", "phone_number"],
  families: ["referrer_name", "family_name", "family_wish", "contact_name", "bio", "address", "phone_number"],
  people: ["family_name", "given_name", "age", "practical_wish", "fun_wish", "title", "note"],
  users: ["email", "password", "role", "referrer_name_or_id", "family_name_or_id", "display_name"],
};

/** Regex that matches a section header line (e.g. `# referrers`). */
const SECTION_RE = /^\s*#\s*(\w+)\s*$/;

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Split raw CSV text into named sections.
 *
 * Each section starts with a comment line like `# referrers`.
 * Returns `{ sectionName: { headers, rows } }` where `headers` is a
 * string array and `rows` is `Array<string[]>`.
 *
 * Blank lines and non-section comment lines are skipped.
 */
export function parseCsvSections(csvText: string): CsvSections {
  const sections: CsvSections = {};
  let currentSection: string | null = null;

  const lines = csvText.split(/\r?\n/);

  for (const line of lines) {
    // Skip blank lines
    if (line.trim() === "") continue;

    // Check for section header
    const match = SECTION_RE.exec(line);
    if (match) {
      currentSection = match[1]!.toLowerCase();
      if (!sections[currentSection]) {
        sections[currentSection] = { headers: [], rows: [] };
      }
      continue;
    }

    // Skip comment lines that aren't section headers
    if (line.trim().startsWith("#")) continue;

    // Parse as CSV row (handle quoted fields)
    if (currentSection !== null) {
      const fields = parseCsvLine(line);
      const section = sections[currentSection]!;

      if (section.headers.length === 0) {
        // First data row is the header
        section.headers = fields.map((f) => f.trim().toLowerCase());
      } else {
        section.rows.push(fields.map((f) => f.trim()));
      }
    }
  }

  return sections;
}

/**
 * Parse a single CSV line respecting quoted fields.
 *
 * Handles double-quotes inside quoted fields (escaped as `""`).
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    i++;
  }

  fields.push(current);
  return fields;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Validate a parsed CSV structure for import.
 *
 * Returns `{ valid, errors, warnings, stats }` where:
 * - `valid` is true only when there are no errors
 * - `errors` is an array of human-readable error strings
 * - `warnings` is an array of non-blocking advisory strings
 * - `stats` has `{ sections, totalRows, unknownSections }`
 */
export function validateCsvForImport(sections: CsvSections): CsvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = {
    sections: 0,
    totalRows: 0,
    unknownSections: [] as string[],
  };

  const sectionNames = Object.keys(sections);

  if (sectionNames.length === 0) {
    errors.push("No sections found. CSV must contain section headers like # referrers, # families, # people, # users.");
    return { valid: false, errors, warnings, stats };
  }

  for (const [name, { headers, rows }] of Object.entries(sections)) {
    const lowerName = name.toLowerCase();

    // Check for unknown sections
    if (!KNOWN_SECTIONS.includes(lowerName as (typeof KNOWN_SECTIONS)[number])) {
      stats.unknownSections.push(name);
      warnings.push(`Unknown section "${name}" — will be ignored by the server.`);
      continue;
    }

    stats.sections++;

    // Check headers
    const expected = EXPECTED_HEADERS[lowerName as (typeof KNOWN_SECTIONS)[number]];
    if (!expected) {
      errors.push(`Section "${name}" has no expected headers defined.`);
      continue;
    }

    if (headers.length === 0) {
      errors.push(`Section "${name}" has no header row.`);
      continue;
    }

    // Check for missing expected columns
    const missing = expected.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      errors.push(`Section "${name}" is missing columns: ${missing.map((h) => `"${h}"`).join(", ")}.`);
    }

    // Check for extra columns (warning only)
    const extra = headers.filter((h) => !expected.includes(h));
    if (extra.length > 0) {
      warnings.push(`Section "${name}" has extra columns: ${extra.map((h) => `"${h}"`).join(", ")}.`);
    }

    // Count data rows
    stats.totalRows += rows.length;

    if (rows.length === 0) {
      warnings.push(`Section "${name}" has headers but no data rows.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

/**
 * Validate a File object is a CSV file by extension.
 */
export function isValidCsvFile(file: { name: string } | null | undefined): boolean {
  if (!file) return false;
  return file.name.toLowerCase().endsWith(".csv");
}
