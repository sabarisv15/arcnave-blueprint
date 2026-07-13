'use strict';

// A pure function, same restraint as generators/templateMerger.js/
// csvGenerator.js etc (Architecture.md 2.6 / ADR-008): no database
// access, no storage access, no business rules, no permissions. Wraps
// tesseract.js's own recognize() call — the one place this codebase
// knows Tesseract's specific API shape, so a future OCR engine swap
// means changing this file alone, same "provider-specific shape lives
// only in this file" convention services/aiProviders/nim.js already
// follows for its own vendor.
//
// Image mime types only (png/jpeg/bmp/tiff) — tesseract.js recognizes
// raster images directly; it has no built-in PDF page rasterizer, and
// this project has no PDF-to-image dependency installed (adding one
// — poppler/ImageMagick-backed — is a real, separate piece of new
// infrastructure, not something to bolt on silently here). A PDF
// upload is therefore still refused by documentSearchService.js's own
// mime-type gate, a real flagged gap, not silently mis-OCR'd.

const Tesseract = require('tesseract.js');

class OcrExtractionError extends Error {}

async function extractTextFromImage(buffer) {
  let result;
  try {
    result = await Tesseract.recognize(buffer, 'eng');
  } catch (err) {
    throw new OcrExtractionError(`Tesseract OCR failed: ${err.message}`);
  }
  const text = result && result.data && typeof result.data.text === 'string' ? result.data.text : '';
  return text.trim();
}

module.exports = { OcrExtractionError, extractTextFromImage };
