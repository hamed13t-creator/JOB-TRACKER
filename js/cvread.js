// Reads CV text on the device. PDF via bundled pdf.js (loaded only when needed), DOCX via a tiny zip reader.

export async function readCvFile(file) {
  const name = file.name || "";
  if (/\.pdf$/i.test(name) || file.type === "application/pdf") return readPdf(file);
  if (/\.docx$/i.test(name) || file.type.includes("officedocument.wordprocessingml")) return readDocx(file);
  if (/\.doc$/i.test(name)) throw new Error("doc");
  return file.text();
}

async function readPdf(file) {
  const base = new URL("../vendor/pdfjs/", import.meta.url).href;
  const pdfjs = await import(base + "pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    let line = "", out = [];
    for (const it of c.items) { line += it.str; if (it.hasEOL) { out.push(line); line = ""; } else if (it.str && !line.endsWith(" ")) line += " "; }
    if (line) out.push(line);
    pages.push(out.join("\n"));
  }
  return pages.join("\n");
}

// --- DOCX: read word/document.xml (+ headers) from the zip ---
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function unzip(buffer, want) {
  const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("zip");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder(), out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const fname = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!want(fname)) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const data = u8.subarray(start, start + csize);
    out[fname] = dec.decode(method === 8 ? await inflateRaw(data) : data);
  }
  return out;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function docxXmlToText(xml) {
  return xml
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10)) : ENT[e] ?? m)
    .replace(/\n{3,}/g, "\n\n").trim();
}

async function readDocx(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) return file.text(); // not a zip: a renamed text file
  const files = await unzip(await file.arrayBuffer(), (n) => n === "word/document.xml" || /^word\/header\d*\.xml$/.test(n));
  if (!files["word/document.xml"]) throw new Error("docx");
  const heads = Object.keys(files).filter((n) => n.includes("header")).map((n) => docxXmlToText(files[n]));
  return [...heads, docxXmlToText(files["word/document.xml"])].filter(Boolean).join("\n");
}
