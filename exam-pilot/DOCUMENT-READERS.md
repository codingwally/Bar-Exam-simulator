# Private Word and PDF question reading

The examiner uploads a file into their own browser. Extraction never sends its
contents to an AI service or a document conversion website. Only the questions
and instructions the examiner confirms are submitted when creating the exam.
The private original extracted text is retained alongside the examination.

- Word uses pinned `mammoth` 1.13.0, with external file access disabled. Its
  HTML output is read as text in an inert document and is never rendered as
  examiner or student HTML. Ordered lists are converted to visible numbering.
- PDF uses Mozilla `pdfjs-dist` 6.4.299 and its matching worker, both self-hosted.
  Dynamic code evaluation is disabled. Reading is cancellable, with page progress.
- File size is limited to 20 MB; PDFs are limited to 100 pages. Source and API
  request limits are separately checked; content is never silently truncated.
- Scanned or textless PDF pages are detected. Their import is refused as a
  whole, preserving any existing draft. OCR is not provided in this build.
  The examiner can paste readable text or export an unlocked text document.
- Legacy binary `.doc` is not represented as DOCX support. The interface asks
  the examiner to save it as `.docx` first. Password-protected or damaged files
  receive a clear fallback. No questions or answer keys are invented.

Run `npm ci --prefix exam-pilot` and `npm run build:documents --prefix exam-pilot`.
The generated `public/document-vendor/LICENSES.json` lists every production
dependency of the prebundled Word reader, its exact version and preserved notices;
the PDF licence is included. Generation fails if a package notice is missing.

`npm run test:documents --prefix exam-pilot` exercises real synthetic DOCX and PDF
files as well as deterministic boundary rules. `test/document-browser.mjs`
exports the CI browser upload/review/link test. Fixture generation is reproducible
with `node exam-pilot/test/create-document-fixtures.mjs`.

Primary references: [Mammoth browser and security documentation](https://github.com/mwilliamson/mammoth.js),
[Mozilla PDF.js examples](https://mozilla.github.io/pdf.js/examples/),
[PDF.js distribution](https://github.com/mozilla/pdfjs-dist).
