import JSZip from "jszip";
import { isSafeExternalUrl } from "@/packages/contracts/src";

const maxArchiveEntries = 10_000;
const maxEntryBytes = 64 * 1024 * 1024;
const maxArchiveExpandedBytes = 128 * 1024 * 1024;
const maxDocumentXmlBytes = 20 * 1024 * 1024;
const maxRelationshipXmlBytes = 2 * 1024 * 1024;
const hyperlinkRelationshipSuffix = "/hyperlink";
const forbiddenRelationshipSuffixes = ["/afchunk", "/altchunk"];
const forbiddenEntryPattern = /(?:^|\/)(?:activex|embeddings|afchunk)(?:\/|$)|vbaProject\.bin$/i;
export type OfficeArchiveFormat = "docx" | "xlsx" | "pptx" | "odt" | "ods" | "odp";
const primaryDocumentPath: Record<OfficeArchiveFormat, string> = {
  docx: "word/document.xml",
  xlsx: "xl/workbook.xml",
  pptx: "ppt/presentation.xml",
  odt: "content.xml",
  ods: "content.xml",
  odp: "content.xml"
};
const officeArchiveType: Record<string, OfficeArchiveFormat> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp"
};

export const officeArchiveFormatForContentType = (contentType: string) => officeArchiveType[contentType.toLowerCase()];

type ZipEntry = {
  _data?: { uncompressedSize?: number };
  async(type: "text"): Promise<string>;
  dir: boolean;
  name: string;
};

const decodeXmlAttribute = (value: string) =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const relationshipAttributes = (source: string) => {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    attributes.set((match[1] ?? "").toLowerCase(), decodeXmlAttribute(match[3] ?? ""));
  }
  return attributes;
};

const relationshipsAreSafe = (xml: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return false;
  for (const match of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/gi)) {
    const attributes = relationshipAttributes(match[1] ?? "");
    const type = (attributes.get("type") ?? "").toLowerCase();
    const target = attributes.get("target") ?? "";
    const external = (attributes.get("targetmode") ?? "").toLowerCase() === "external";

    if (forbiddenRelationshipSuffixes.some((suffix) => type.endsWith(suffix))) return false;
    if (!external) continue;
    if (!type.endsWith(hyperlinkRelationshipSuffix) || !isSafeExternalUrl(target)) return false;
  }
  return true;
};

export const validateOfficeArchive = async (bytes: Uint8Array, format: OfficeArchiveFormat) => {
  try {
    const archive = await JSZip.loadAsync(bytes);
    const entries = Object.values(archive.files) as ZipEntry[];
    if (entries.length > maxArchiveEntries || entries.some((entry) => forbiddenEntryPattern.test(entry.name))) {
      return false;
    }

    let totalUncompressedBytes = 0;
    for (const entry of entries) {
      const uncompressedSize = Number(entry._data?.uncompressedSize ?? 0);
      if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0 || uncompressedSize > maxEntryBytes) {
        return false;
      }
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > maxArchiveExpandedBytes) return false;
    }

    const document = archive.file(primaryDocumentPath[format]) as ZipEntry | null;
    const contentTypes = archive.file("[Content_Types].xml") as ZipEntry | null;
    if (!document || (["docx", "xlsx", "pptx"].includes(format) && !contentTypes)) return false;
    if (Number(document._data?.uncompressedSize ?? 0) > maxDocumentXmlBytes) return false;

    const documentXml = await document.async("text");
    const contentTypesXml = contentTypes ? await contentTypes.async("text") : "";
    if (/<!DOCTYPE|<!ENTITY/i.test(documentXml) || /(?:text\/html|application\/xhtml\+xml)/i.test(contentTypesXml)) {
      return false;
    }

    for (const entry of entries.filter((candidate) => /(?:^|\/)_rels\/.*\.rels$/i.test(candidate.name))) {
      if (Number(entry._data?.uncompressedSize ?? 0) > maxRelationshipXmlBytes) return false;
      if (!relationshipsAreSafe(await entry.async("text"))) return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const validateDocxArchive = (bytes: Uint8Array) => validateOfficeArchive(bytes, "docx");
