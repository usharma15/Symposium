import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  buildStructuredAttachmentMetadata,
  parseCsvPreview,
  structuredPreviewFromMetadata
} from "@/lib/structuredAttachmentPreview";

const makeFile = async (zip: JSZip, name: string, type: string) => {
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], name, { type });
};

const main = async () => {
const csv = parseCsvPreview('name,score,note\nAda,10,"quoted, value"\nLinus,9,kernel');
assert.deepEqual(csv.sheets[0]?.rows[1], ["Ada", "10", "quoted, value"]);

const xlsx = new JSZip();
xlsx.file("xl/workbook.xml", '<workbook><sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>');
xlsx.file("xl/sharedStrings.xml", '<sst><si><t>Name</t></si><si><t>Score</t></si><si><t>Ada</t></si></sst>');
xlsx.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>10</v></c></row></sheetData></worksheet>');
const xlsxMetadata = await buildStructuredAttachmentMetadata(
  await makeFile(xlsx, "results.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  "spreadsheet"
);
const xlsxPreview = structuredPreviewFromMetadata(xlsxMetadata);
assert.equal(xlsxPreview?.type, "spreadsheet");
if (xlsxPreview?.type === "spreadsheet") {
  assert.equal(xlsxPreview.sheets[0]?.name, "Results");
  assert.deepEqual(xlsxPreview.sheets[0]?.rows[1], ["Ada", "10"]);
}

const pptx = new JSZip();
pptx.file("ppt/slides/slide1.xml", '<p:sld><p:cSld><a:t>Discovery</a:t><a:t>Question</a:t><a:t>Method</a:t></p:cSld></p:sld>');
pptx.file("ppt/slides/slide2.xml", '<p:sld><p:cSld><a:t>Results</a:t><a:t>Evidence</a:t></p:cSld></p:sld>');
const pptxMetadata = await buildStructuredAttachmentMetadata(
  await makeFile(pptx, "talk.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
  "presentation"
);
const pptxPreview = structuredPreviewFromMetadata(pptxMetadata);
assert.equal(pptxPreview?.type, "presentation");
if (pptxPreview?.type === "presentation") {
  assert.equal(pptxPreview.slides.length, 2);
  assert.deepEqual(pptxPreview.slides[0], { title: "Discovery", lines: ["Question", "Method"] });
}

const pythonMetadata = await buildStructuredAttachmentMetadata(
  new File(["def answer():\n    return 42\n"], "answer.py", { type: "text/x-python" }),
  "code"
);
assert.equal(pythonMetadata.language, "Python");
assert.match(String(pythonMetadata.previewText), /return 42/);
assert.ok(new TextEncoder().encode(JSON.stringify(xlsxMetadata)).byteLength < 64 * 1024);
assert.ok(new TextEncoder().encode(JSON.stringify(pptxMetadata)).byteLength < 64 * 1024);

console.log(JSON.stringify({
  ok: true,
  checked: [
    "quoted CSV cell parsing",
    "XLSX shared-string and worksheet extraction",
    "PPTX slide extraction",
    "source-code metadata",
    "bounded structured metadata"
  ]
}, null, 2));
};

void main();

export {};
