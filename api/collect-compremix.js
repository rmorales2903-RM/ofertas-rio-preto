import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const DATABASE_URL = process.env.DATABASE_URL;
const OFFERS_URL = 'https://www.compremixatacado.com.br/ofertas/';
const STORE_NAME = 'Compre Mix - Jardim Primavera';
const STORE_ADDRESS = 'Av. Jornalista Roberto Marinho, 3239 - Jd. Primavera - São José do Rio Preto/SP';

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function normalizeKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180);
}
function decodeHtml(value) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ');
}

function categoryFor(name) {
  const n = normalizeText(name);
  if (/\b(racao|alimento para cao|alimento para caes|alimento para gato|alimento para gatos|pet shop|whiskas|pedigree)\b/.test(n)) return 'Outros';
  if (/\b(shampoo|condicionador|sabonete|desodorante|absorvente|creme dental|enxaguante|escova dental|aparelho de barbear|fralda|serum|leave in|tratamento capilar|creme de tratamento|oleo de queratina|higiene)\b/.test(n)) return 'Higiene e Beleza';
  if (/\b(detergente|amaciante|desinfetante|sabao|lava roupas|limpador|limpa tudo|limpa vidros|desengordurante|tira manchas|papel toalha|toalha de papel|agua sanitaria)\b/.test(n)) return 'Limpeza';
  if (/\b(arroz|feijao|macarrao|massa|farinha|acucar|oleo de soja|oleo de girassol|oleo misto|azeite|molho|extrato|tomate pelado|caldo|tempero|cafe|cha|milho|farofa|maionese|ketchup|mostarda|conserva|atum|sardinha|azeitona|pipoca|tapioca|adocante|sacarina|aveia|mel)\b/.test(n)) return 'Mercearia';
  if (/\b(presunto|mortadela|salame|bacon|linguica|salsicha|peito de peru)\b/.test(n)) return 'Frios e Embutidos';
  if (/\b(leite|iogurte|manteiga|margarina|queijo|requeijao|bebida lactea|creme de leite)\b/.test(n)) return 'Laticínios';
  if (/\b(refrigerante|suco|agua de coco|agua mineral|cerveja|vinho|espumante|energetico|isotonico)\b/.test(n)) return 'Bebidas';
  if (/\b(chocolate|bombom|biscoito|cookie|wafer|doce|chiclete|bala|sobremesa)\b/.test(n)) return 'Doces e Chocolates';
  if (/\b(cebola|alface|manga|uva|banana|melao|melancia|batata|cenoura|pimentao|brocolis|couve|berinjela|mamao|pera|maca|alho|abobora|fruta|verdura|legume)\b/.test(n)) return 'Hortifruti';
  if (/\btomate\b/.test(n) && !/\b(molho|extrato|pelado|seco|ketchup)\b/.test(n)) return 'Hortifruti';
  if (/\b(sorvete|acai|pizza congelada|batata palito|lasanha|empanado|congelados?)\b/.test(n)) return 'Congelados';
  if (/\b(pao|baguete|cuca|bolo|torta)\b/.test(n)) return 'Padaria';
  if (/\b(panceta|carne bovina|carne suina|carne moida|bovina|suina|suino|frango|peito de frango|coxa|sobrecoxa|figado|picanha|file mignon|tilapia|salmao|peixe|camarao|bacalhau|costela|lombo|bisteca|asa)\b/.test(n)) return 'Carnes';
  return 'Outros';
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

function parseValidity(text) {
  const compact = normalizeText(text);
  const year = new Date().getFullYear();
  let m = compact.match(/(?:validas?|precos validos|de)\s+(?:para os dias\s+)?(\d{1,2})\s*(?:a|ate|e)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  if (m) {
    const y = m[4] ? Number(String(m[4]).length === 2 ? `20${m[4]}` : m[4]) : year;
    return { validFrom:`${y}-${String(m[3]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`, validUntil:`${y}-${String(m[3]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}` };
  }
  m = compact.match(/(?:de|validas? de)\s+(\d{1,2})\/(\d{1,2})\s*(?:a|ate|e)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  if (m) {
    const y = m[5] ? Number(String(m[5]).length === 2 ? `20${m[5]}` : m[5]) : year;
    return { validFrom:`${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`, validUntil:`${y}-${String(m[4]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}` };
  }
  return { validFrom:null, validUntil:null };
}
function moneyToNumber(value) {
  const n = Number(String(value || '').replace(/\./g,'').replace(',','.').replace(/[^0-9.]/g,''));
  return Number.isFinite(n) ? n : null;
}
function cleanProductName(value) {
  return String(value || '').replace(/cliente\s+clube.*$/i,'').replace(/oferta\s+especial.*$/i,'').replace(/\s+/g,' ').replace(/^[-•*\s]+|[-•*\s]+$/g,'').trim();
}
function looksLikeProductName(s) {
  const n = normalizeText(s);
  if (s.length < 4 || s.length > 180) return false;
  if (/^(cliente clube|cada|kg|unidade|oferta|ofertas|atacado compre mix|orgulho de ser|precos validos|siga nossas|aceitamos|televendas|horarios|mande um oi|pix|www\.|@)/i.test(s)) return false;
  if (/^(r\$|\d+[,.]\d{2})/.test(n)) return false;
  return /[a-zA-ZÀ-ÿ]{3}/.test(s);
}

function parseOffersFromPdfText(text, sourceUrl) {
  const validity = parseValidity(text);
  const lines = String(text || '').split(/\r?\n/).map(x => x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const rows = [];
  const seen = new Set();
  const priceRe = /R\s*\$\s*([0-9.]+\s*,\s*[0-9]{2})/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const priceMatches = [...line.matchAll(priceRe)];
    if (!priceMatches.length) continue;

    const isClubLine = /cliente\s+clube/i.test(line);
    if (isClubLine) continue;

    let namePart = line.slice(0, priceMatches[0].index).trim();
    if (!looksLikeProductName(namePart)) {
      const candidates = [lines[i-1], lines[i-2], lines[i-3]].filter(Boolean).filter(looksLikeProductName);
      namePart = candidates[0] || '';
    }
    const name = cleanProductName(namePart);
    if (!looksLikeProductName(name)) continue;

    let regular = moneyToNumber(priceMatches[0][1]);
    let offer = regular;
    let loyaltyRequired = false;
    let loyaltyLabel = null;

    const window = [line, lines[i+1] || '', lines[i+2] || ''].join(' ');
    const clubMatch = window.match(/cliente\s+clube\s+paga\s+R\s*\$\s*([0-9.]+\s*,\s*[0-9]{2})/i);
    if (clubMatch) {
      const clubPrice = moneyToNumber(clubMatch[1]);
      if (clubPrice > 0 && clubPrice <= regular) {
        offer = clubPrice;
        loyaltyRequired = true;
        loyaltyLabel = 'Cliente CLUBE';
      }
    } else if (priceMatches.length >= 2) {
      const p2 = moneyToNumber(priceMatches[priceMatches.length-1][1]);
      if (p2 > 0 && p2 <= regular) offer = p2;
    }
    if (!offer || offer <= 0 || offer > 100000) continue;

    const signature = `${normalizeKey(name)}|${offer}|${sourceUrl}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    rows.push({
      canonical_name:name, brand:null, category_name:categoryFor(name), normalized_key:normalizeKey(`compremix-${name}`),
      source_product_name:name, source_url:sourceUrl, regular_price:regular, offer_price:offer,
      loyalty_required:loyaltyRequired, loyalty_label:loyaltyLabel,
      valid_from:validity.validFrom, valid_until:validity.validUntil,
      source_hash:createHash('sha256').update(`compremix|${sourceUrl}|${normalizeKey(name)}|${offer}`).digest('hex').slice(0,48),
      raw_payload:{source:'compremix-pdf',source_url:sourceUrl,source_line:line}
    });
  }
  return rows;
}

async function ensureStore(sql) {
  const rows = await sql`
    with sm as (select id from supermarkets where name='Compre Mix' limit 1), ct as (select id from cities where name='São José do Rio Preto' limit 1)
    insert into stores (supermarket_id,city_id,name,address,external_code,is_active)
    select sm.id,ct.id,${STORE_NAME},${STORE_ADDRESS},'compremix-jd-primavera',true from sm,ct
    on conflict (supermarket_id,city_id,name) do update set address=excluded.address,external_code=excluded.external_code,is_active=true returning id`;
  if (!rows.length) throw new Error('Compre Mix or São José do Rio Preto seed not found');
  return rows[0].id;
}

async function saveBatch(sql, storeId, rows) {
  if (!rows.length) return 0;
  const payload = JSON.stringify(rows);
  await sql`
    with input as (
      select * from jsonb_to_recordset(${payload}::jsonb) as x(canonical_name text,brand text,category_name text,normalized_key text,source_product_name text,source_url text,regular_price numeric,offer_price numeric,loyalty_required boolean,loyalty_label text,valid_from date,valid_until date,source_hash text,raw_payload jsonb)
    ), product_input as (
      select i.*,c.id as category_id from input i left join categories c on c.name=i.category_name
    ), upsert_products as (
      insert into products (canonical_name,brand,category_id,normalized_key,updated_at)
      select canonical_name,brand,category_id,normalized_key,now() from product_input
      on conflict (normalized_key) do update set canonical_name=excluded.canonical_name,category_id=excluded.category_id,updated_at=now()
      returning id,normalized_key
    ), offer_input as (
      select pi.*,up.id as product_id from product_input pi join upsert_products up using (normalized_key)
    ), upsert_offers as (
      insert into offers (store_id,product_id,source_product_name,source_url,regular_price,offer_price,unit_price,loyalty_required,loyalty_label,valid_from,valid_until,collected_at,source_hash,raw_payload,is_active)
      select ${storeId},product_id,source_product_name,source_url,regular_price,offer_price,null,loyalty_required,loyalty_label,coalesce(valid_from,current_date),valid_until,now(),source_hash,raw_payload,true from offer_input
      on conflict (store_id,source_hash) do update set product_id=excluded.product_id,source_product_name=excluded.source_product_name,source_url=excluded.source_url,regular_price=excluded.regular_price,offer_price=excluded.offer_price,loyalty_required=excluded.loyalty_required,loyalty_label=excluded.loyalty_label,valid_from=excluded.valid_from,valid_until=excluded.valid_until,collected_at=excluded.collected_at,raw_payload=excluded.raw_payload,is_active=true
      returning id,product_id,store_id,offer_price,regular_price
    )
    insert into price_history (product_id,store_id,price,regular_price,observed_at,offer_id)
    select u.product_id,u.store_id,u.offer_price,u.regular_price,now(),u.id from upsert_offers u
    where not exists (select 1 from price_history ph where ph.product_id=u.product_id and ph.store_id=u.store_id and ph.price=u.offer_price and coalesce(ph.regular_price,-1)=coalesce(u.regular_price,-1) and ph.observed_at>now()-interval '5 hours')`;
  return rows.length;
}

export default async function handler(req,res) {
  if (req.method!=='GET' && req.method!=='POST') return res.status(405).json({ok:false,error:'method_not_allowed'});
  if (!DATABASE_URL) return res.status(500).json({ok:false,error:'missing_database_url'});
  const sql=neon(DATABASE_URL); const startedAt=new Date();
  try {
    const storeId=await ensureStore(sql);
    const html=await fetchText(OFFERS_URL);
    const pdfLinks=extractPdfLinks(html);
    if (!pdfLinks.length) throw new Error('No current Compre Mix PDF offers found');
    const warnings=[]; const allRows=[]; const diagnostics=[]; let pdfsParsed=0;
    for (const url of pdfLinks) {
      try {
        const buffer=await fetchBuffer(url);
        const parsed=await pdfParse(buffer);
        const pdfText=parsed.text || '';
        const rows=parseOffersFromPdfText(pdfText,url);
        diagnostics.push({url,text_chars:pdfText.length,lines:pdfText.split(/\r?\n/).filter(Boolean).length,rows:rows.length,sample:pdfText.replace(/\s+/g,' ').slice(0,240)});
        if (!rows.length) continue;
        pdfsParsed++; allRows.push(...rows);
      } catch(e) { warnings.push({url,error:String(e?.message||e)}); }
    }
    const unique=new Map(); for (const row of allRows) unique.set(row.source_hash,row); const rows=[...unique.values()];
    let saved=0; for (let i=0;i<rows.length;i+=100) saved+=await saveBatch(sql,storeId,rows.slice(i,i+100));
    if (rows.length>0) await sql`update offers set is_active=false where store_id=${storeId} and raw_payload->>'source'='compremix-pdf' and collected_at<${startedAt.toISOString()}::timestamptz`;
    const counts=await sql`select c.name as category,count(*)::int as offers from offers o join products p on p.id=o.product_id left join categories c on c.id=p.category_id where o.store_id=${storeId} and o.is_active=true and (o.valid_until is null or o.valid_until>=current_date) group by c.name order by offers desc,c.name`;
    return res.status(200).json({ok:true,source:'Compre Mix',source_provider:'compremixatacado.com.br (tabloides oficiais em PDF)',store:STORE_NAME,pdfs_found:pdfLinks.length,pdfs_parsed:pdfsParsed,offers_parsed:rows.length,saved,categories:counts,warnings:warnings.slice(0,5),diagnostics:diagnostics.slice(0,3)});
  } catch(error) {
    console.error('collect-compremix',error);
    return res.status(500).json({ok:false,error:String(error?.message||error)});
  }
}
