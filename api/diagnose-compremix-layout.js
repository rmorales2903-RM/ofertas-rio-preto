import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const OFFERS_URL = 'https://www.compremixatacado.com.br/ofertas/';

function decodeHtml(value) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ');
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Promo-Supermercado-Bot/1.0' } });
  if (!r.ok) throw new Error(`Compre Mix ${r.status}: ${url}`);
  return r.text();
}

async function fetchBuffer(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Promo-Supermercado-Bot/1.0' } });
  if (!r.ok) throw new Error(`Compre Mix PDF ${r.status}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

function extractPdfLinks(html) {
  const links = new Set();
  const re = /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi;
  for (const m of html.matchAll(re)) {
    try {
      const u = new URL(decodeHtml(m[1]), OFFERS_URL);
      if (u.hostname === 'www.compremixatacado.com.br') links.add(u.toString());
    } catch {}
  }
  return [...links].slice(0, 10);
}

function reconstructRows(items) {
  const rows = [];
  for (const item of items || []) {
    if (!item?.str?.trim() || !item.transform) continue;
    const x = Number(item.transform[4] || 0);
    const y = Number(item.transform[5] || 0);
    let row = rows.find(r => Math.abs(r.y - y) <= 2.5);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, text: item.str.trim() });
  }
  return rows.sort((a,b) => b.y - a.y).map(r => {
    const cells = r.items.sort((a,b) => a.x - b.x).map(i => ({ x:Number(i.x.toFixed(2)), text:i.text }));
    return { y:Number(r.y.toFixed(2)), cells, text:cells.map(i=>i.text).join(' ').replace(/\s+/g,' ').trim() };
  }).filter(r => r.text);
}

export default async function handler(req, res) {
  try {
    const html = await fetchText(OFFERS_URL);
    const pdfLinks = extractPdfLinks(html);
    if (!pdfLinks.length) return res.status(404).json({ ok:false, error:'no_pdfs' });
    const diagnostics = [];

    for (const url of pdfLinks.slice(0, 2)) {
      const buffer = await fetchBuffer(url);
      const pageLayouts = [];
      let pageIndex = 0;
      const pagerender = async pageData => {
        const textContent = await pageData.getTextContent({ normalizeWhitespace:false, disableCombineTextItems:false });
        pageIndex += 1;
        const rows = reconstructRows(textContent.items);
        pageLayouts.push({ page:pageIndex, items:textContent.items.length, rows:rows.length, sample_rows:rows.slice(0,80) });
        return rows.map(r => r.text).join('\n');
      };
      const parsed = await pdfParse(buffer, { pagerender, max:3 });
      diagnostics.push({ url, pages_reported:parsed.numpages, text_chars:(parsed.text || '').length, pages:pageLayouts });
    }

    return res.status(200).json({ ok:true, pdfs_found:pdfLinks.length, diagnostics });
  } catch (error) {
    console.error('diagnose-compremix-layout', error);
    return res.status(500).json({ ok:false, error:String(error?.message || error) });
  }
}
