import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const URL = 'https://www.compremixatacado.com.br/wp-content/uploads/2026/08/TABLOIDES-LIMPEZA-SETEMBRO-V4-1.pdf';

function rawItems(items) {
  return (items || []).filter(i => i?.str?.trim() && i.transform).map(i => ({
    text: i.str.trim(),
    x: Number(i.transform[4] || 0),
    y: Number(i.transform[5] || 0)
  }));
}

function colForX(x) {
  if (x < 205) return 0;
  if (x < 400) return 1;
  if (x < 590) return 2;
  return 3;
}

function cleanName(parts) {
  return parts.join(' ')
    .replace(/\bS?DESINFETANT\s+E\b/gi, 'DESINFETANTE')
    .replace(/\bPAP\.HIG\b/gi, 'PAPEL HIGIENICO')
    .replace(/\bPAP TOALHA\b/gi, 'PAPEL TOALHA')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOffers(items) {
  const all = rawItems(items);
  const cents = all.filter(i => /^,\d{2}$/.test(i.text));
  const integers = all.filter(i => /^\d{1,3}$/.test(i.text));
  const priceAnchors = [];

  for (const int of integers) {
    const col = colForX(int.x);
    const c = cents
      .filter(x => colForX(x.x) === col && x.x > int.x && x.x - int.x < 75 && Math.abs(x.y - int.y) < 15)
      .sort((a,b) => Math.abs(a.y-int.y)-Math.abs(b.y-int.y))[0];
    if (!c) continue;
    const price = Number(`${int.text}.${c.text.slice(1)}`);
    if (!Number.isFinite(price) || price < 0.1 || price > 999) continue;
    priceAnchors.push({ col, y:(int.y+c.y)/2, price, int, cents:c });
  }

  const offers = [];
  for (const p of priceAnchors) {
    const parts = all
      .filter(i => colForX(i.x) === p.col && Math.abs(i.y - p.y) <= 29)
      .filter(i => i !== p.int && i !== p.cents)
      .filter(i => !/^(R|\$|C|A|D)$/i.test(i.text))
      .filter(i => !/^,\d{2}$/.test(i.text))
      .filter(i => !/^\d{1,3}$/.test(i.text))
      .sort((a,b) => b.y - a.y || a.x - b.x)
      .map(i => i.text);
    const name = cleanName(parts);
    if (!/[A-Za-zÀ-ÿ]{3}/.test(name)) continue;
    offers.push({ col:p.col+1, y:Number(p.y.toFixed(1)), name, price:p.price });
  }

  const dedup = new Map();
  for (const o of offers) dedup.set(`${o.col}|${o.y}|${o.price}`, o);
  return [...dedup.values()].sort((a,b) => b.y-a.y || a.col-b.col);
}

async function pagerender(pageData) {
  const tc = await pageData.getTextContent({ normalizeWhitespace:true, disableCombineTextItems:false });
  globalThis.__offers ||= [];
  globalThis.__offers.push(extractOffers(tc.items));
  return tc.items.map(i => i.str || '').join(' ');
}

const r = await fetch(URL, { headers:{'user-agent':'Mozilla/5.0'} });
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const buf = Buffer.from(await r.arrayBuffer());
const parsed = await pdfParse(buf, { pagerender });
console.log(JSON.stringify({ ok:true, pagesCount:parsed.numpages, offers:(globalThis.__offers||[]).flat() }, null, 2));
