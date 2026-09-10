import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const URL = 'https://www.compremixatacado.com.br/wp-content/uploads/2026/08/TABLOIDES-LIMPEZA-SETEMBRO-V4-1.pdf';

function reconstructRows(items) {
  const rows=[];
  for (const item of items||[]) {
    if (!item?.str?.trim() || !item.transform) continue;
    const x=Number(item.transform[4]||0), y=Number(item.transform[5]||0);
    let row=rows.find(r=>Math.abs(r.y-y)<=2.5);
    if(!row){row={y,items:[]}; rows.push(row);}
    row.items.push({x,text:item.str.trim()});
  }
  return rows.sort((a,b)=>b.y-a.y).map(r=>({y:r.y,text:r.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ').replace(/\s+/g,' ').trim(),items:r.items})).filter(r=>r.text);
}

async function pagerender(pageData) {
  const tc=await pageData.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
  const rows=reconstructRows(tc.items);
  globalThis.__rows ||= [];
  globalThis.__rows.push(rows);
  return rows.map(r=>r.text).join('\n');
}

const r=await fetch(URL,{headers:{'user-agent':'Mozilla/5.0'}});
if(!r.ok) throw new Error(`HTTP ${r.status}`);
const buf=Buffer.from(await r.arrayBuffer());
const parsed=await pdfParse(buf,{pagerender});
const pages=(globalThis.__rows||[]).map((rows,i)=>({page:i+1,rows:rows.slice(0,120)}));
console.log(JSON.stringify({ok:true,pagesCount:parsed.numpages,textChars:(parsed.text||'').length,pages},null,2));
