'use strict';

// Module 9 (AI) — shared data-classification-access matrix. Originally
// inline in aiToolRegistry.js's own Policy Gate (see ADR-020); pulled
// out into its own module because the RAG slice's search_documents
// tool needs the identical role -> classification mapping for a
// SECOND, independent purpose: per-ROW filtering of retrieved document
// chunks inside documentSearchService.searchDocuments, not just the
// Policy Gate's single tool-level classification check
// (AI-Governance.md §4: "action level and data classification are two
// independent checks" — this extends that same reasoning to ROWS
// within one tool call, not just tools themselves). Both callers
// import the one table here rather than each keeping their own copy
// that could silently drift apart.
//
// Conservative default, not sourced from BusinessRules.md (which does
// not yet define an AI-actor/data-classification matrix) — still
// Proposed, not settled; see ADR-020.
const ROLE_CLASSIFICATION_ACCESS = {
  principal: ['Internal', 'Confidential', 'Restricted'],
  hod: ['Internal', 'Confidential'],
  staff: ['Internal'],
};

// An unrecognized role gets no classifications at all, not every
// classification — the same fail-closed default the Policy Gate's own
// assertPolicyAllows already relies on via `|| []`.
function permittedClassifications(role) {
  return ROLE_CLASSIFICATION_ACCESS[role] || [];
}

module.exports = { ROLE_CLASSIFICATION_ACCESS, permittedClassifications };
