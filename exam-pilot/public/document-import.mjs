import { validateQuestions } from "./import.mjs";

export const STANDARD_DIRECTIONS =
  "Write your answer in the space provided for each question. Your work saves automatically. Review your answers before submitting. Keep using the same device and browser profile.";
const clean = (text) =>
  String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
const answerKey =
  /^\s*(?:answer\s*key|suggested\s+answers?|model\s+answers?|correct\s+answers?)\s*(?:[:—-]|$)/im;
const romanValue = (text) => {
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  return [...text].reduce(
    (sum, c, i, a) =>
      sum + (values[c] < values[a[i + 1]] ? -values[c] : values[c]),
    0,
  );
};

/** Deterministic boundaries only. Subquestions remain inside their parent item. */
export function examFromText(source) {
  const original = clean(source),
    lines = original.split("\n"),
    candidates = [];
  if (!original)
    return {
      sourceText: "",
      instructions: "",
      questions: [],
      warnings: [
        "No readable text was found. Paste the questions or add them below.",
      ],
    };
  if (answerKey.test(original))
    throw Object.assign(
      new Error(
        "This document appears to include an answer key. Remove answer material, then upload the question paper again.",
      ),
      { sourceText: original },
    );
  const questionSection = lines.findIndex((line) =>
    /^\s*(?:(?:part|section)\s+[A-ZIVX\d]+[.:–—-]?\s*|[IVX]+[.)]\s*)?(?:essay\s+)?questions\s*:?\s*$/i.test(
      line,
    ),
  );
  const instructionHeading =
    /^\s*(?:(?:part|section)\s+[A-ZIVX\d]+[.:–—-]?\s*|[IVX]+[.)]\s*)?(?:general\s+)?(?:instructions|directions|reminders)\s*(?::.*)?$/i;
  const isNumbered =
    /^\s*(?:(?:question|q)\s*\d+\b|\d+[.)](?:\s|$)|[IVXLC]+[.)](?:\s|$))/i;
  const beforeHeading = lines.slice(0, Math.max(0, questionSection));
  const precedingNumber = beforeHeading.findIndex(
    (line) => isNumbered.test(line) && !instructionHeading.test(line),
  );
  if (
    precedingNumber >= 0 &&
    !beforeHeading
      .slice(0, precedingNumber)
      .some((line) => instructionHeading.test(line))
  ) {
    throw Object.assign(
      new Error(
        "A Questions heading appears after numbered text. Check the original paper and mark every main question as “Question 1”, “Question 2” before reading it again. No questions were imported.",
      ),
      { sourceText: original },
    );
  }
  for (const [line, value] of lines.entries()) {
    if (line <= questionSection) continue;
    let match = value.match(
      /^(\s*)(?:question|q)\s*(\d+)\s*[.):–—-]?\s*(.*)$/i,
    );
    if (match) {
      candidates.push({
        line,
        indent: match[1].replaceAll("\t", "    ").length,
        style: "explicit",
        source: Number(match[2]),
        text: match[3],
      });
      continue;
    }
    match = value.match(/^(\s*)(\d+)[.)](?:\s+(.*)|\s*)$/);
    if (match) {
      candidates.push({
        line,
        indent: match[1].replaceAll("\t", "    ").length,
        style: "number",
        source: Number(match[2]),
        text: match[3] || "",
      });
      continue;
    }
    match = value.match(/^(\s*)([IVXLC]+)[.)](?:\s+(.*)|\s*)$/);
    if (
      match &&
      !/^(?:general\s+)?(?:instructions|directions|reminders)\s*:?\s*$/i.test(
        match[3] || "",
      )
    )
      candidates.push({
        line,
        indent: match[1].replaceAll("\t", "    ").length,
        style: "roman",
        source: romanValue(match[2]),
        text: match[3] || "",
      });
  }
  const firstExplicit = candidates.find(
    (candidate) => candidate.style === "explicit",
  );
  if (
    firstExplicit &&
    candidates.some((candidate) => candidate.line < firstExplicit.line)
  ) {
    throw Object.assign(
      new Error(
        "The paper mixes numbered questions with later “Question” labels. Mark all main questions consistently before reading it again. No questions were imported.",
      ),
      { sourceText: original },
    );
  }
  const style = candidates.some((c) => c.style === "explicit")
    ? "explicit"
    : candidates[0]?.style;
  const selected = candidates.filter((c) => c.style === style),
    indent = Math.min(...selected.map((c) => c.indent));
  const markers = selected.filter((c) => c.indent === indent);
  if (!markers.length)
    return {
      sourceText: original,
      instructions: original,
      questions: [],
      warnings: [
        "No numbered questions were found. Mark question boundaries in the original text, or add the questions manually below.",
      ],
    };
  const seen = new Set();
  for (const marker of markers) {
    if (seen.has(marker.source))
      throw Object.assign(
        new Error(
          "Question numbering repeats at the same level. Check the original text and indent subquestions, or use “Question 1”, “Question 2” for the main questions.",
        ),
        { sourceText: original },
      );
    seen.add(marker.source);
  }
  const questions = markers.map((marker, index) => ({
    number: index + 1,
    text: clean(
      [
        marker.text,
        ...lines.slice(
          marker.line + 1,
          markers[index + 1]?.line ?? lines.length,
        ),
      ].join("\n"),
    ),
    instructions: "",
  }));
  const errors = validateQuestions(questions);
  if (errors.length)
    throw Object.assign(new Error(errors.join("\n")), { sourceText: original });
  return {
    sourceText: original,
    instructions: clean(lines.slice(0, markers[0].line).join("\n")),
    questions,
    warnings: markers.some((m, i) => m.source !== i + 1)
      ? [
          "Questions have been numbered 1 onward. The original numbering is preserved in the original text below.",
        ]
      : [],
  };
}

export function examDirections(preamble) {
  return [clean(preamble), STANDARD_DIRECTIONS].filter(Boolean).join("\n\n");
}

export function textFromDocxHTML(html, Parser = globalThis.DOMParser) {
  if (!Parser)
    throw new Error(
      "Document preview is unavailable in this browser. Export as text and paste the questions.",
    );
  const doc = new Parser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const walk = (element, depth = 0) => {
    if (element.nodeType === 3) return element.textContent;
    const tag = element.nodeName.toLowerCase();
    if (["script", "style", "img", "iframe", "object"].includes(tag)) return "";
    if (tag === "br") return "\n";
    if (tag === "ol" || tag === "ul") {
      const start = Number(element.getAttribute("start") || 1);
      return [...element.children]
        .map(
          (li, i) =>
            `${"  ".repeat(depth)}${tag === "ol" ? `${i + (Number.isSafeInteger(start) ? start : 1)}.` : "•"} ${[
              ...li.childNodes,
            ]
              .map((child) => walk(child, depth + 1))
              .join("")
              .trim()}\n`,
        )
        .join("");
    }
    const text = [...element.childNodes]
      .map((child) => walk(child, depth))
      .join("");
    return ["p", "h1", "h2", "h3", "h4", "tr"].includes(tag)
      ? `${text}\n`
      : text;
  };
  return clean(walk(doc.body));
}

export function textFromPDFItems(items) {
  const lines = [];
  for (const item of items) {
    if (!("str" in item) || !item.str) continue;
    const x = item.transform?.[4] || 0,
      y = item.transform?.[5] || 0;
    let line = lines.find((line) => Math.abs(line.y - y) < 2);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, text: item.str, width: item.width || 0 });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .reduce(
          (out, part, i, parts) =>
            out +
            (i &&
            part.x > parts[i - 1].x + parts[i - 1].width + 0.5 &&
            !out.endsWith(" ")
              ? " "
              : "") +
            part.text,
          "",
        ),
    )
    .join("\n");
}

export function checkDocxArchive(buffer) {
  const view = new DataView(buffer);
  const invalid = () => {
    throw new Error(
      "The Word document could not be read. Its archive is damaged or uses an unsupported format. Export an unlocked .docx or paste the questions.",
    );
  };
  const unsupported = () => {
    throw new Error(
      "This Word archive uses an unsupported large-file format. Export a smaller question paper or paste the text.",
    );
  };
  const tooLarge = () => {
    throw new Error(
      "The unpacked Word document is too large. Remove images or export just the question paper, then try again.",
    );
  };
  // Walk the real central directory. Scanning compressed payload bytes for
  // signatures can mistake ordinary file data for metadata or skip true entries.
  let end = -1;
  for (
    let offset = view.byteLength - 22;
    offset >= Math.max(0, view.byteLength - 65557);
    offset--
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === view.byteLength
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) invalid();
  const disk = view.getUint16(end + 4, true),
    directoryDisk = view.getUint16(end + 6, true);
  const diskEntries = view.getUint16(end + 8, true),
    entries = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (
    disk ||
    directoryDisk ||
    diskEntries !== entries ||
    entries === 0xffff ||
    directorySize === 0xffffffff ||
    start === 0xffffffff
  )
    unsupported();
  if (entries > 2000) tooLarge();
  if (!entries || start + directorySize !== end) invalid();
  let offset = start,
    total = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      invalid();
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) unsupported();
    total += size;
    if (total > 40 * 1024 * 1024) tooLarge();
    const length =
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (
      local + 30 > start ||
      view.getUint32(local, true) !== 0x04034b50 ||
      offset + 46 + length > end
    )
      invalid();
    offset += 46 + length;
  }
  if (offset !== end) invalid();
  return { entries, total };
}

export async function readExamFile(
  file,
  {
    onProgress = () => {},
    signal,
    mammothLoader = () => import("./document-vendor/mammoth.mjs"),
    pdfLoader = () => import("./document-vendor/pdf.mjs"),
  } = {},
) {
  const check = () => {
    if (signal?.aborted)
      throw new DOMException("Reading cancelled.", "AbortError");
  };
  check();
  if (file.size > 20 * 1024 * 1024)
    throw new Error(
      "This file is larger than 20 MB. Export the question paper as a smaller Word document or text PDF, or paste the questions.",
    );
  const ext = file.name.split(".").at(-1).toLowerCase();
  if (ext === "doc")
    throw new Error(
      "This is an older Word .doc file. Open it in Word and choose Save As → Word Document (.docx), then upload that file.",
    );
  if (["txt", "md"].includes(ext)) {
    const source = await file.text();
    check();
    return { ...examFromText(source), format: "text" };
  }
  if (ext === "docx") {
    onProgress("Reading Word document…");
    const buffer = await file.arrayBuffer();
    check();
    if (
      new Uint8Array(buffer)[0] !== 0x50 ||
      new Uint8Array(buffer)[1] !== 0x4b
    )
      throw new Error(
        "This file is not a readable Word .docx document. Export it again from Word or paste the questions.",
      );
    checkDocxArchive(buffer);
    try {
      const { default: mammoth } = await mammothLoader();
      check();
      const result = await mammoth.convertToHtml(
        { arrayBuffer: buffer },
        {
          externalFileAccess: false,
          convertImage: mammoth.images.imgElement(() =>
            Promise.resolve({ src: "" }),
          ),
        },
      );
      check();
      const parsed = examFromText(textFromDocxHTML(result.value));
      return {
        ...parsed,
        format: "docx",
        warnings: [
          ...parsed.warnings,
          ...(result.messages.length
            ? [
                "Word reported formatting that could not be preserved. Check the full question text below.",
              ]
            : []),
        ],
      };
    } catch (error) {
      if (error.name === "AbortError" || error.sourceText) throw error;
      throw new Error(
        "The Word document could not be read. It may be damaged or password protected. Export an unlocked .docx or paste the questions.",
      );
    }
  }
  if (ext === "pdf") {
    onProgress("Reading PDF…");
    const buffer = await file.arrayBuffer();
    check();
    if (
      new TextDecoder().decode(new Uint8Array(buffer).slice(0, 5)) !== "%PDF-"
    )
      throw new Error(
        "This file is not a readable PDF. Export it again or paste the questions.",
      );
    const pdfjs = await pdfLoader();
    check();
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "./document-vendor/pdf.worker.mjs",
      import.meta.url,
    ).href;
    let loading, document, abort;
    try {
      loading = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      abort = () => loading.destroy();
      signal?.addEventListener("abort", abort, { once: true });
      document = await loading.promise;
      check();
      if (document.numPages > 100)
        throw new Error(
          "This PDF has more than 100 pages. Upload just the question paper, or paste the questions.",
        );
      const pages = [],
        scanned = [];
      for (let n = 1; n <= document.numPages; n++) {
        check();
        onProgress(`Reading PDF page ${n} of ${document.numPages}…`);
        const page = await document.getPage(n);
        const content = await page.getTextContent();
        const text = textFromPDFItems(content.items);
        if (!text.trim()) scanned.push(n);
        pages.push(text);
        page.cleanup();
      }
      check();
      if (scanned.length)
        throw Object.assign(
          new Error(
            `No readable text was found on PDF page${scanned.length === 1 ? "" : "s"} ${scanned.join(", ")}. This may be a scanned document. Use Word’s text export, or paste the questions. No incomplete question paper was imported.`,
          ),
          { sourceText: pages.join("\n\n"), scannedPages: scanned },
        );
      const parsed = examFromText(pages.join("\n\n"));
      return {
        ...parsed,
        format: "pdf",
        warnings: [
          ...parsed.warnings,
          "PDF reading order can differ from the printed page. Check each complete question and its subquestions.",
        ],
      };
    } catch (error) {
      if (signal?.aborted)
        throw new DOMException("Reading cancelled.", "AbortError");
      if (
        error.sourceText !== undefined ||
        error.message?.includes("more than 100")
      )
        throw error;
      throw new Error(
        error.name === "PasswordException"
          ? "This PDF needs a password. Export an unlocked copy or paste the questions."
          : "The PDF could not be read. Export it again or paste the questions.",
      );
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
      await loading?.destroy();
    }
  }
  throw new Error(
    "Choose a Word .docx document, PDF, or plain text file. You can also paste the questions.",
  );
}
