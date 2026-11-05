import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
const dir = new URL("./fixtures/", import.meta.url);
await mkdir(dir, { recursive: true });
const xml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const paragraphs = [
  "Constitutional Law I — Practice",
  "Instructions: Explain your reasoning.",
  "1. A fictional council considers a rule.",
  "a) Identify the issue.",
  "b) Explain the consequence.",
  "2. A fictional department reviews a decision.",
  "Discuss the limits of its authority.",
];
export async function docxFixture(
  lines,
  { automatic = false, roman = false } = {},
) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
  );
  zip.file(
    "word/numbering.xml",
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${roman ? "upperRoman" : "decimal"}"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((line, index) => `<w:p>${automatic && index >= 2 ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : ""}<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join("")}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
await writeFile(
  new URL("teaching-paper.docx", dir),
  await docxFixture(paragraphs),
);
await writeFile(
  new URL("automatic-numbering.docx", dir),
  await docxFixture(
    [
      "A practice paper",
      "Instructions: Explain each conclusion.",
      "First automatic numbered question.",
      "Second automatic numbered question.",
    ],
    { automatic: true },
  ),
);
await writeFile(
  new URL("roman-numbering.docx", dir),
  await docxFixture(
    [
      "Roman numbered practice",
      "Explain each conclusion.",
      "First Roman question.",
      "Second Roman question.",
    ],
    { automatic: true, roman: true },
  ),
);
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica),
  page = pdf.addPage([612, 792]);
let y = 745;
for (const line of paragraphs.map((line) => line.replace("—", "-"))) {
  page.drawText(line, { x: 50, y, size: 12, font });
  y -= 26;
}
await writeFile(new URL("teaching-paper.pdf", dir), await pdf.save());
const scan = await PDFDocument.create(),
  scanPage = scan.addPage([612, 792]);
scanPage.drawRectangle({
  x: 20,
  y: 20,
  width: 570,
  height: 750,
  color: rgb(0.9, 0.9, 0.9),
});
await writeFile(new URL("textless-paper.pdf", dir), await scan.save());
await writeFile(new URL("malformed.docx", dir), "PK invalid zip document");
await writeFile(new URL("malformed.pdf", dir), "%PDF-1.7 invalid document");
await writeFile(
  new URL("answer-key.txt", dir),
  "1. A fictional question.\nSuggested answer: Never expose this as a student question.",
);
await writeFile(
  new URL("no-questions.txt", dir),
  "Practice instructions\nUse the same browser and review your writing before submitting.",
);
console.log("Created synthetic Word/PDF/text fixtures.");
