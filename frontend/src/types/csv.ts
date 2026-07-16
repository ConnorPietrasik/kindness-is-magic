/** CSV parsing/validation return types (derived from src/lib/csv.js) */

/**
 * A single parsed CSV section.
 *
 * `headers` is the first data row (trimmed, lowercase).
 * `rows` is the remaining data rows (trimmed).
 */
export interface CsvSection {
  headers: string[];
  rows: string[][];
}

/**
 * Map of section name → parsed section data,
 * as returned by `parseCsvSections()`.
 */
export interface CsvSections {
  [section: string]: CsvSection;
}

/**
 * Result of `validateCsvForImport()`.
 */
export interface CsvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: CsvValidationStats;
}

/**
 * Summary statistics inside a validation result.
 */
export interface CsvValidationStats {
  sections: number;
  totalRows: number;
  unknownSections: string[];
}
