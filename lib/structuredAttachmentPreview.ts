import type { AttachmentKindContract } from "@/packages/contracts/src";

export type SpreadsheetPreviewSheet = { name: string; rows: string[][] };
export type SpreadsheetPreview = { type: "spreadsheet"; sheets: SpreadsheetPreviewSheet[] };
export type PresentationPreviewSlide = { title: string; lines: string[] };
export type PresentationPreview = { type: "presentation"; slides: PresentationPreviewSlide[] };
export type StructuredAttachmentPreview = SpreadsheetPreview | PresentationPreview;

const maxSheets = 3;
const maxRows = 12;
const maxColumns = 8;
const maxSlides = 25;
const maxSlideLines = 10;
const maxCellLength = 100;
const maxPreviewArchiveEntries = 10_000;
const maxPreviewArchiveEntryBytes = 64 * 1024 * 1024;
const maxPreviewArchiveExpandedBytes = 128 * 1024 * 1024;
const maxPreviewXmlBytes = 4 * 1024 * 1024;

type PreviewZipEntry = {
  _data?: { uncompressedSize?: number };
  async(type: "text"): Promise<string>;
};
type PreviewZip = {
  file(path: string): PreviewZipEntry | null;
  files: Record<string, PreviewZipEntry>;
};

const loadPreviewArchive = async (file: File): Promise<PreviewZip> => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer()) as unknown as PreviewZip;
  const entries = Object.values(zip.files);
  if (entries.length > maxPreviewArchiveEntries) throw new Error("This archive is too complex to preview safely.");
  let expandedBytes = 0;
  for (const entry of entries) {
    const bytes = Number(entry._data?.uncompressedSize ?? 0);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxPreviewArchiveEntryBytes) {
      throw new Error("This archive entry is too large to preview safely.");
    }
    expandedBytes += bytes;
    if (expandedBytes > maxPreviewArchiveExpandedBytes) throw new Error("This archive is too large to preview safely.");
  }
  return zip;
};

const previewArchiveText = async (zip: PreviewZip, path: string) => {
  const entry = zip.file(path);
  if (!entry || Number(entry._data?.uncompressedSize ?? 0) > maxPreviewXmlBytes) return "";
  return entry.async("text");
};

const decodeXml = (value: string) => value
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"")
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
  .trim()
  .slice(0, maxCellLength);

const fileExtension = (fileName: string) => fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";

export const sourceLanguageForFileName = (fileName: string) => {
  const extension = fileExtension(fileName).slice(1);
  const aliases: Record<string, string> = {
    asm: "Assembly", bash: "Bash", c: "C", cc: "C++", conf: "Configuration", cpp: "C++", cxx: "C++", cs: "C#", css: "CSS", dart: "Dart", erl: "Erlang", ex: "Elixir", exs: "Elixir", fish: "Fish", fs: "F#", fsx: "F#", go: "Go", gradle: "Gradle", graphql: "GraphQL", groovy: "Groovy",
    h: "C/C++ header", hpp: "C++ header", hs: "Haskell", html: "HTML", java: "Java", js: "JavaScript",
    jsx: "JSX", json: "JSON", kt: "Kotlin", kts: "Kotlin", lua: "Lua", m: "Objective-C", mm: "Objective-C++",
    ini: "INI", ipynb: "Jupyter Notebook", php: "PHP", pl: "Perl", ps1: "PowerShell", py: "Python", r: "R", rb: "Ruby", rs: "Rust", s: "Assembly", scala: "Scala", sh: "Shell",
    sql: "SQL", swift: "Swift", tex: "TeX", toml: "TOML", ts: "TypeScript", tsx: "TSX", vb: "Visual Basic", vue: "Vue", xml: "XML",
    yaml: "YAML", yml: "YAML", zsh: "Zsh"
  };
  return aliases[extension] ?? (extension ? extension.toUpperCase() : "Source code");
};

export const parseCsvPreview = (source: string): SpreadsheetPreview => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length && rows.length < maxRows; index += 1) {
    const character = source[index] ?? "";
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      if (row.length < maxColumns) row.push(field.trim().slice(0, maxCellLength));
      field = "";
    } else if (character === "\n") {
      if (row.length < maxColumns) row.push(field.replace(/\r$/, "").trim().slice(0, maxCellLength));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (rows.length < maxRows && (field || row.length)) {
    if (row.length < maxColumns) row.push(field.trim().slice(0, maxCellLength));
    rows.push(row);
  }
  return { type: "spreadsheet", sheets: [{ name: "CSV", rows }] };
};

const columnIndex = (reference: string) => {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const numericFileOrder = (left: string, right: string) => {
  const leftNumber = Number(left.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0);
  const rightNumber = Number(right.match(/(\d+)(?=\.xml$)/)?.[1] ?? 0);
  return leftNumber - rightNumber;
};

const extractSharedStrings = (xml: string) => Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g))
  .map((match) => Array.from((match[0] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((text) => decodeXml(text[1] ?? "")).join(""));

const extractWorksheetRows = (xml: string, sharedStrings: string[]) => Array.from(xml.matchAll(/<row\b[\s\S]*?<\/row>/g))
  .slice(0, maxRows)
  .map((rowMatch) => {
    const values: string[] = [];
    for (const cellMatch of (rowMatch[0] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "A1";
      const index = columnIndex(reference);
      if (index >= maxColumns) continue;
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
        ?? Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((match) => match[1] ?? "").join("");
      values[index] = (type === "s" ? sharedStrings[Number(rawValue)] ?? "" : decodeXml(rawValue)).slice(0, maxCellLength);
    }
    return Array.from({ length: Math.min(maxColumns, Math.max(0, values.length)) }, (_unused, index) => values[index] ?? "");
  });

const extractXlsxPreview = async (file: File): Promise<SpreadsheetPreview> => {
  const zip = await loadPreviewArchive(file);
  const sharedXml = await previewArchiveText(zip, "xl/sharedStrings.xml");
  const sharedStrings = sharedXml ? extractSharedStrings(sharedXml) : [];
  const workbookXml = await previewArchiveText(zip, "xl/workbook.xml");
  const names = Array.from(workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*>/g)).map((match) => decodeXml(match[1] ?? ""));
  const paths = Object.keys(zip.files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path)).sort(numericFileOrder).slice(0, maxSheets);
  const sheets: SpreadsheetPreviewSheet[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const xml = await previewArchiveText(zip, paths[index]!);
    sheets.push({ name: names[index] || `Sheet ${index + 1}`, rows: extractWorksheetRows(xml, sharedStrings) });
  }
  return { type: "spreadsheet", sheets };
};

const extractOpenDocumentSpreadsheet = async (file: File): Promise<SpreadsheetPreview> => {
  const zip = await loadPreviewArchive(file);
  const xml = await previewArchiveText(zip, "content.xml");
  const sheets = Array.from(xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)).slice(0, maxSheets).map((sheet, sheetIndex) => {
    const name = decodeXml((sheet[1] ?? "").match(/table:name="([^"]+)"/)?.[1] ?? `Sheet ${sheetIndex + 1}`);
    const rows = Array.from((sheet[2] ?? "").matchAll(/<table:table-row\b[\s\S]*?<\/table:table-row>/g)).slice(0, maxRows).map((row) =>
      Array.from((row[0] ?? "").matchAll(/<table:table-cell\b[\s\S]*?<\/table:table-cell>/g)).slice(0, maxColumns).map((cell) =>
        Array.from((cell[0] ?? "").matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)).map((text) => decodeXml(text[1] ?? "")).join(" ").slice(0, maxCellLength)
      )
    );
    return { name, rows };
  });
  return { type: "spreadsheet", sheets };
};

const extractPptxPreview = async (file: File): Promise<PresentationPreview> => {
  const zip = await loadPreviewArchive(file);
  const paths = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path)).sort(numericFileOrder).slice(0, maxSlides);
  const slides: PresentationPreviewSlide[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const xml = await previewArchiveText(zip, paths[index]!);
    const text = Array.from(xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)).map((match) => decodeXml(match[1] ?? "")).filter(Boolean).slice(0, maxSlideLines + 1);
    slides.push({ title: text[0] || `Slide ${index + 1}`, lines: text.slice(1) });
  }
  return { type: "presentation", slides };
};

const extractOpenDocumentPresentation = async (file: File): Promise<PresentationPreview> => {
  const zip = await loadPreviewArchive(file);
  const xml = await previewArchiveText(zip, "content.xml");
  const slides = Array.from(xml.matchAll(/<draw:page\b([^>]*)>([\s\S]*?)<\/draw:page>/g)).slice(0, maxSlides).map((slide, index) => {
    const text = Array.from((slide[2] ?? "").matchAll(/<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)).map((match) => decodeXml(match[1] ?? "")).filter(Boolean).slice(0, maxSlideLines + 1);
    const fallbackTitle = decodeXml((slide[1] ?? "").match(/draw:name="([^"]+)"/)?.[1] ?? `Slide ${index + 1}`);
    return { title: text[0] || fallbackTitle, lines: text.slice(1) };
  });
  return { type: "presentation", slides };
};

const extractOpenDocumentText = async (file: File) => {
  const zip = await loadPreviewArchive(file);
  const xml = await previewArchiveText(zip, "content.xml");
  return Array.from(xml.matchAll(/<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)).map((match) => decodeXml(match[1] ?? "")).filter(Boolean).join("\n\n").slice(0, 50_000);
};

const extractLegacyOfficeText = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  return Array.from(text.matchAll(/[\x20-\x7e]{5,}/g)).map((match) => match[0]?.trim() ?? "").filter((line) => line.length > 4 && !/^Microsoft (?:Office|Excel|PowerPoint|Word)/i.test(line)).slice(0, 500).join("\n").slice(0, 50_000);
};

export const buildStructuredAttachmentMetadata = async (file: File, kind: AttachmentKindContract) => {
  const extension = fileExtension(file.name);
  if (kind === "code") {
    const previewText = (await file.text()).slice(0, 50_000);
    return { previewText, pageCount: Math.max(1, Math.ceil(previewText.length / 2200)), language: sourceLanguageForFileName(file.name) };
  }
  if (kind === "spreadsheet") {
    const structuredPreview = extension === ".csv" ? parseCsvPreview(await file.text())
      : extension === ".xlsx" ? await extractXlsxPreview(file)
      : extension === ".ods" ? await extractOpenDocumentSpreadsheet(file)
      : null;
    if (structuredPreview) return { structuredPreview, pageCount: Math.max(1, structuredPreview.sheets.length) };
    return { previewText: await extractLegacyOfficeText(file), pageCount: 1 };
  }
  if (kind === "presentation") {
    const structuredPreview = extension === ".pptx" ? await extractPptxPreview(file)
      : extension === ".odp" ? await extractOpenDocumentPresentation(file)
      : null;
    if (structuredPreview) return { structuredPreview, pageCount: Math.max(1, structuredPreview.slides.length) };
    return { previewText: await extractLegacyOfficeText(file), pageCount: 1 };
  }
  if (kind === "document" && extension === ".odt") {
    const previewText = await extractOpenDocumentText(file);
    return { previewText, pageCount: Math.max(1, Math.ceil(previewText.length / 2200)) };
  }
  if (kind === "document" && extension === ".doc") {
    const previewText = await extractLegacyOfficeText(file);
    return { previewText, pageCount: Math.max(1, Math.ceil(previewText.length / 2200)) };
  }
  return {};
};

export const structuredPreviewFromMetadata = (metadata: Record<string, unknown> | undefined): StructuredAttachmentPreview | null => {
  const value = metadata?.structuredPreview;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type === "spreadsheet" && Array.isArray(record.sheets)) return value as SpreadsheetPreview;
  if (record.type === "presentation" && Array.isArray(record.slides)) return value as PresentationPreview;
  return null;
};
