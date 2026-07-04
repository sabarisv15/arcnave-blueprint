'use strict';

// Generator Module (Architecture.md 2.6 / ADR-008): a pure function.
// No database access, no storage access, no business rules, no
// permissions — takes a ReportModel ({title, columns, rows}),
// returns bytes. Never calls DocumentService or Storage directly
// (ADR-008's own Consequences) — ReportService does that after
// getting bytes back from here.
//
// Quoting/BOM match frontend/src/components/CsvExportModal.jsx's own
// convention (the one real CSV-export precedent in this codebase):
// every value double-quoted with internal quotes doubled, and a UTF-8
// BOM prefix for Excel compatibility — so a report generated here
// looks like the same kind of file that modal already produces
// client-side, not a new one invented from scratch.
//
// CSV only, this slice — Excel/PDF/Word generators are deferred until
// a real screen needs them (see .ai/TASK.md), same restraint every
// other module's first slice applies to unbuilt capability.

const UTF8_BOM = '﻿';

function csvEscape(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function generate(reportModel) {
  const { columns, rows } = reportModel;
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c.id])).join(','));
  }
  return Buffer.from(UTF8_BOM + lines.join('\n'), 'utf8');
}

module.exports = { generate };
