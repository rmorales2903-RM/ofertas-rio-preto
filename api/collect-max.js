import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const SOURCE_ROOT = 'https://365ofertas.com.br/max-atacadista/';
const STORE_NAME = 'Max Atacadista - Rio Preto';
const STORE_ADDRESS = 'São José do Rio Preto, SP';

const MONTHS = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&atilde;/gi, 'ã')
    .replace(/&otilde;/gi, 'õ')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú');
}

function stripHtml(value) {
  return decodeHtml(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function moneyToNumber(value) {
  const cleaned = String(value || '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isoDate(day, monthName, year) {
  const month = MONTHS[normalizeText(monthName)] || MONTHS[String(monthName || '').toLowerCase()];
  if (!month) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseValidity(text) {
  const m = text.match(/v[aá]lido\s+de\s+(\d{1,2})\s+de\s+([a-zçãáéíóú]+)\s+de\s+(\d{4})\s+at[eé]\s+(\d{1,2})\s+de\s+([a-zçãáéíóú]+)\s+de\s+(\d{4})/i);
  if (!m) return { validFrom: null, validUntil: null };
  return {
    validFrom: isoDate(m[1], m[2], m[3]),
    validUntil: isoDate(m[4], m[5], m[6])
  };
}

function categoryFor(name) {
  const n = normalizeText(name);
  if (/\b(carne|bovina|suina|suino|frango|peito de frango|coxa|sobrecoxa|figado|picanha|file mignon|tilapia|salmao|peixe|camarao)\b/.test(n)) return 'Carnes';
  if (/\b(presunto|mortadela|salame|bacon|linguica|salsicha|peito de peru)\b/.test(n)) return 'Frios e Embutidos';
  if (/\b(leite|iogurte|manteiga|queijo|requeijao|bebida lactea|creme de leite)\b/.test(n)) return 'Laticínios';
  if (/\b(refrigerante|suco|agua|cerveja|vinho|espumante|energetico|isotonico)\b/.test(n)) return 'Bebidas';
  if (/\b(chocolate|bombom|biscoito|cookie|wafer|doce|chiclete|bala)\b/.test(n)) return 'Doces e Chocolates';
  if (/\b(cebola|tomate|alface|manga|uva|banana|melao|melancia|batata|cenoura|pimentao|brocolis|couve|fruta|verdura|legume)\b/.test(n)) return 'Hortifruti';
  if (/\b(congelad|sorvete|pizza|batata palito|empanado|tekitos)\b/.test(n)) return 'Congelados';
  if (/\b(pao|baguete|cuca|bolo|torta)\b/.test(n)) return 'Padaria';
  if (/\b(detergente|amaciante|desinfetante|sabao|limpeza|papel toalha)\b/.test(n)) return 'Limpeza';
  if (/\b(shampoo|condicionador|sabonete|desodorante|absorvente|creme dental|higiene)\b/.test(n)) return 'Higiene e Beleza';
  if (/\b(arroz|feijao|macarrao|massa|farinha|acucar|oleo|azeite|molho|tempero|cafe|cha|milho|farofa|maionese|ketchup|mostarda|conserva)\b/.test(n)) return 'Mercearia';
  return 'Outros';
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 Promo-Supermercado-Bot/1.0'
    }
  });
  if (!r.ok) throw new Error(`Fonte Max ${r.status}: ${url}`);
  return r.text();
}

function extractCampaignLinks(html) {
  const links = new Set();
  const re = /href=["']([^"']*\/max-atacadista\/[^"'#?]+)["']/gi;
  for (const m of html.matchAll(re)) {
    let href = decodeHtml(m[1]);
    try {
      const u = new URL(href, SOURCE_ROOT);
      if (u.hostname !== '365ofertas.com.br') continue;
      if (u.pathname === '/max-atacadista/' || !u.pathname.startsWith('/max-atacadista/')) continue;
      links.add(u.toString());
    } catch {}
  }
  return [...links].slice(0, 20);
}

function extractOfferRows(html, sourceUrl) {
  const wholeText = stripHtml(html);
  const validity = parseValidity(wholeText);
  const rows = [];
  const seen = new Set();
  const blocks = [];

  for (const tag of ['li', 'p']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    for (const m of html.matchAll(re)) blocks.push(stripHtml(m[1]));
  }

  for (const block of blocks) {
    if (!/R\$\s*\d/i.test(block)) continue;
    if (block.length < 8 || block.length > 520) continue;

    const priceMatches = [...block.matchAll(/R\$\s*([0-9.]+,[0-9]{2})/gi)].map(m => moneyToNumber(m[1])).filter(v => v != null);
    if (!priceMatches.length) continue;

    const dashIndex = block.search(/\s[–—-]\s(?=(?:por\s+|agora\s+|de\s+)?R\$)/i);
    let name;
    if (dashIndex > 2) name = block.slice(0, dashIndex).trim();
    else {
      const rIndex = block.search(/(?:por\s+|agora\s+|de\s+)?R\$/i);
      name = rIndex > 2 ? block.slice(0, rIndex).replace(/[–—-]+\s*$/, '').trim() : '';
    }
    name = name.replace(/^[-•*\s]+/, '').replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 180) continue;

    const lower = normalizeText(block);
    const loyalty = /clube max|somente.*app|apenas.*app|oferta.*app/.test(lower);
    let regular = null;
    let offer = priceMatches[priceMatches.length - 1];
    if (/\bde\s+r\$/i.test(block) && priceMatches.length >= 2) regular = priceMatches[0];
    if (!offer || offer <= 0 || offer > 100000) continue;
    if (regular != null && regular < offer) regular = null;

    const dedupe = `${normalizeKey(name)}|${offer}|${sourceUrl}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    rows.push({
      canonical_name: name,
      brand: null,
      category_name: categoryFor(name),
      normalized_key: normalizeKey(`max-${name}`),
      source_product_name: name,
      source_url: sourceUrl,
      regular_price: regular,
      offer_price: offer,
      loyalty_required: loyalty,
      loyalty_label: loyalty ? 'Clube Max / App' : null,
      valid_from: validity.validFrom,
      valid_until: validity.validUntil,
      source_hash: createHash('sha256').update(`max-365|${sourceUrl}|${normalizeKey(name)}|${offer}`).digest('hex').slice(0, 48),
      raw_payload: { source: '365ofertas-max', source_url: sourceUrl, source_text: block }
    });
  }
  return rows;
}

async function ensureStore(sql) {
  const rows = await sql`
    with sm as (select id from supermarkets where name = 'Max Atacadista' limit 1),
         ct as (select id from cities where name = 'São José do Rio Preto' limit 1)
    insert into stores (supermarket_id, city_id, name, address, external_code, is_active)
    select sm.id, ct.id, ${STORE_NAME}, ${STORE_ADDRESS}, 'max-rio-preto-encartes', true
    from sm, ct
    on conflict (supermarket_id, city_id, name)
    do update set address = excluded.address, external_code = excluded.external_code, is_active = true
    returning id
  `;
  if (!rows.length) throw new Error('Max Atacadista or São José do Rio Preto seed not found');
  return rows[0].id;
}

async function saveBatch(sql, storeId, rows) {
  if (!rows.length) return 0;
  const payload = JSON.stringify(rows);
  await sql`
    with input as (
      select * from jsonb_to_recordset(${payload}::jsonb) as x(
        canonical_name text, brand text, category_name text, normalized_key text,
        source_product_name text, source_url text, regular_price numeric, offer_price numeric,
        loyalty_required boolean, loyalty_label text, valid_from date, valid_until date,
        source_hash text, raw_payload jsonb
      )
    ), product_input as (
      select i.*, c.id as category_id
      from input i left join categories c on c.name=i.category_name
    ), upsert_products as (
      insert into products (canonical_name, brand, category_id, normalized_key, updated_at)
      select canonical_name, brand, category_id, normalized_key, now() from product_input
      on conflict (normalized_key) do update set
        canonical_name=excluded.canonical_name,
        category_id=excluded.category_id,
        updated_at=now()
      returning id, normalized_key
    ), offer_input as (
      select pi.*, up.id as product_id
      from product_input pi join upsert_products up using (normalized_key)
    ), upsert_offers as (
      insert into offers (
        store_id, product_id, source_product_name, source_url, regular_price, offer_price,
        unit_price, loyalty_required, loyalty_label, valid_from, valid_until, collected_at,
        source_hash, raw_payload, is_active
      )
      select ${storeId}, product_id, source_product_name, source_url, regular_price, offer_price,
             null, loyalty_required, loyalty_label, coalesce(valid_from,current_date), valid_until,
             now(), source_hash, raw_payload, true
      from offer_input
      on conflict (store_id, source_hash) do update set
        product_id=excluded.product_id,
        source_product_name=excluded.source_product_name,
        source_url=excluded.source_url,
        regular_price=excluded.regular_price,
        offer_price=excluded.offer_price,
        loyalty_required=excluded.loyalty_required,
        loyalty_label=excluded.loyalty_label,
        valid_from=excluded.valid_from,
        valid_until=excluded.valid_until,
        collected_at=excluded.collected_at,
        raw_payload=excluded.raw_payload,
        is_active=true
      returning id, product_id, store_id, offer_price, regular_price
    )
    insert into price_history (product_id, store_id, price, regular_price, observed_at, offer_id)
    select u.product_id, u.store_id, u.offer_price, u.regular_price, now(), u.id
    from upsert_offers u
    where not exists (
      select 1 from price_history ph
      where ph.product_id=u.product_id and ph.store_id=u.store_id and ph.price=u.offer_price
        and coalesce(ph.regular_price,-1)=coalesce(u.regular_price,-1)
        and ph.observed_at > now() - interval '5 hours'
    )
  `;
  return rows.length;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  if (!DATABASE_URL) return res.status(500).json({ ok:false, error:'missing_database_url' });

  const sql = neon(DATABASE_URL);
  const startedAt = new Date();
  try {
    const storeId = await ensureStore(sql);
    const landingHtml = await fetchHtml(SOURCE_ROOT);
    const campaignLinks = extractCampaignLinks(landingHtml);
    if (!campaignLinks.length) throw new Error('No Max campaigns found');

    let fetchedCampaigns = 0;
    let parsed = 0;
    let saved = 0;
    const errors = [];
    const allRows = [];
    const today = new Date().toISOString().slice(0,10);

    for (const url of campaignLinks) {
      try {
        const html = await fetchHtml(url);
        const validity = parseValidity(stripHtml(html));
        if (validity.validUntil && validity.validUntil < today) continue;
        const rows = extractOfferRows(html, url);
        if (!rows.length) continue;
        fetchedCampaigns++;
        parsed += rows.length;
        allRows.push(...rows);
      } catch (e) {
        errors.push({ url, error: String(e?.message || e) });
      }
    }

    const unique = new Map();
    for (const row of allRows) unique.set(`${row.source_hash}`, row);
    const rows = [...unique.values()];
    for (let i=0;i<rows.length;i+=100) saved += await saveBatch(sql, storeId, rows.slice(i,i+100));

    if (rows.length > 0) {
      await sql`
        update offers set is_active=false
        where store_id=${storeId}
          and raw_payload->>'source'='365ofertas-max'
          and collected_at < ${startedAt.toISOString()}::timestamptz
      `;
    }

    const counts = await sql`
      select c.name as category, count(*)::int as offers
      from offers o join products p on p.id=o.product_id left join categories c on c.id=p.category_id
      where o.store_id=${storeId} and o.is_active=true
        and (o.valid_until is null or o.valid_until >= current_date)
      group by c.name order by offers desc, c.name
    `;

    return res.status(200).json({
      ok:true,
      source:'Max Atacadista',
      source_provider:'365ofertas.com.br (encartes publicados do Max)',
      store:STORE_NAME,
      campaigns_found:campaignLinks.length,
      campaigns_parsed:fetchedCampaigns,
      offers_parsed:parsed,
      saved,
      categories:counts,
      warnings:errors.slice(0,5)
    });
  } catch (error) {
    console.error('collect-max', error);
    return res.status(500).json({ ok:false, error:String(error?.message || error) });
  }
}
