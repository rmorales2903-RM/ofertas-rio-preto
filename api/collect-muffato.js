import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
const BASE = 'https://www.supermuffato.com.br';
const PAGE_SIZE = 50;
const MAX_PAGES = 30;

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function categoryFor(product) {
  const categories = (product.categories || []).join(' ').toLowerCase();
  const name = String(product.productName || '').toLowerCase();

  // A árvore oficial do Muffato é a fonte principal de classificação.
  // Isso evita falsos positivos de texto, como "suave" contendo "ave"
  // ou ração "sabor carne" sendo classificada como carne humana.
  if (/pet shop|c[aã]es|gatos|ra[cç][aã]o/.test(categories)) return 'Outros';
  if (/higiene e beleza|cuidados pessoais|perfumaria/.test(categories)) return 'Higiene e Beleza';
  if (/limpeza|lavanderia/.test(categories)) return 'Limpeza';
  if (/doces e chocolates|chocolates e bombons|balas|chicletes/.test(categories)) return 'Doces e Chocolates';
  if (/frios e latic[ií]nios|latic[ií]nios|leites|iogurtes|queijos|manteigas|margarinas/.test(categories)) return 'Laticínios';
  if (/frios|embutidos|presuntos|salames|mortadelas/.test(categories)) return 'Frios e Embutidos';
  if (/carnes, aves e peixes|carnes bovinas|carnes su[ií]nas|aves e frangos|peixes e frutos do mar|a[cç]ougue/.test(categories)) return 'Carnes';
  if (/bebidas|refrigerantes|sucos|cervejas|vinhos|[aá]guas|energ[eé]ticos/.test(categories)) return 'Bebidas';
  if (/hortifruti|frutas|verduras|legumes|hortali[cç]as/.test(categories)) return 'Hortifruti';
  if (/congelados|sorvetes/.test(categories)) return 'Congelados';
  if (/padaria|p[aã]es|confeitaria/.test(categories)) return 'Padaria';
  if (/mercearia e alimentos|mercearia|alimentos/.test(categories)) return 'Mercearia';

  // Fallback apenas quando a árvore de categorias não ajuda.
  if (/alimento para c[aã]es|alimento para gatos|petisco para c[aã]es|petisco para gatos|ra[cç][aã]o/.test(name)) return 'Outros';
  if (/absorvente|shampoo|condicionador|sabonete|desodorante|creme dental/.test(name)) return 'Higiene e Beleza';
  if (/detergente|amaciante|desinfetante|sab[aã]o|lava roupa|tira manchas/.test(name)) return 'Limpeza';
  if (/chocolate|bombom|biscoito|cookie|wafer|sobremesa|confeito|bala|chiclete/.test(name)) return 'Doces e Chocolates';
  if (/presunto|salame|mortadela|bacon|peito de peru/.test(name)) return 'Frios e Embutidos';
  if (/leite|iogurte|manteiga|margarina|queijo|requeij|creme de leite|bebida l[aá]ctea/.test(name)) return 'Laticínios';
  if (/carne|frango|su[ií]n|bovin|peixe|salm[aã]o|til[aá]pia|camar[aã]o|lingui[cç]a|bisteca|costela|lombo|fil[eé] mignon/.test(name)) return 'Carnes';
  if (/refrigerante|suco|[aá]gua mineral|energ[eé]tico|isot[oô]nico|cerveja|vinho/.test(name)) return 'Bebidas';
  if (/alface|tomate|uva|manga|banana|ma[cç][aã]|laranja|batata|cebola|cenoura|verdura|legume|fruta/.test(name)) return 'Hortifruti';
  if (/congelad|sorvete|pizza congelada/.test(name)) return 'Congelados';
  if (/p[aã]o|bolo|torta/.test(name)) return 'Padaria';
  if (/arroz|feij[aã]o|massa|macarr[aã]o|caf[eé]|ch[aá]|molho|tempero|conserva|farinha|a[cç][uú]car|[oó]leo|azeite|cereal|salgadinho|amendoim|aveia/.test(name)) return 'Mercearia';
  return 'Outros';
}

function bestOffer(product) {
  let best = null;
  for (const item of product.items || []) {
    for (const seller of item.sellers || []) {
      const offer = seller.commertialOffer || {};
      const price = Number(offer.Price || 0);
      const list = Number(offer.ListPrice || price || 0);
      const qty = Number(offer.AvailableQuantity ?? 1);
      if (!price || qty <= 0) continue;
      if (!best || price < best.price) {
        best = { item, seller, offer, price, listPrice: list >= price ? list : price };
      }
    }
  }
  return best;
}

async function fetchPage(from, to) {
  const url = `${BASE}/api/catalog_system/pub/products/search/?fq=H:9204&_from=${from}&_to=${to}`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 Promo-Supermercado-Bot/1.0'
    }
  });
  if (!response.ok) throw new Error(`Muffato VTEX ${response.status} ${from}-${to}`);
  const totalHeader = response.headers.get('resources') || response.headers.get('content-range');
  return { products: await response.json(), totalHeader };
}

function makeRecords(products) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const product of products) {
    const chosen = bestOffer(product);
    if (!chosen) continue;
    const { item, price, listPrice } = chosen;
    const name = product.productName || item.name || `Produto ${product.productId}`;
    const skuId = String(item.itemId || '0');
    const productId = String(product.productId || '0');
    const brand = product.brand || null;
    const key = normalizeKey(`${name}-${brand || ''}-${skuId}`);
    const discount = listPrice > price ? Number((((listPrice - price) / listPrice) * 100).toFixed(1)) : 0;
    rows.push({
      canonical_name: name,
      brand,
      category_name: categoryFor(product),
      normalized_key: key,
      source_product_name: name,
      source_url: product.link || `${BASE}/${product.linkText || ''}/p`,
      image_url: item.images?.[0]?.imageUrl || null,
      regular_price: listPrice || null,
      offer_price: price,
      discount_pct: discount,
      valid_until: today,
      source_hash: `muffato-vtex:${productId}:${skuId}`,
      raw_payload: { source: 'muffato-vtex', productId, skuId, categoryPath: product.categories || [] }
    });
  }
  return rows;
}

async function saveBatch(sql, storeId, rows) {
  if (!rows.length) return 0;
  const payload = JSON.stringify(rows);
  await sql`
    with input as (
      select * from jsonb_to_recordset(${payload}::jsonb) as x(
        canonical_name text,
        brand text,
        category_name text,
        normalized_key text,
        source_product_name text,
        source_url text,
        image_url text,
        regular_price numeric,
        offer_price numeric,
        discount_pct numeric,
        valid_until date,
        source_hash text,
        raw_payload jsonb
      )
    ), product_input as (
      select i.*, c.id as category_id
      from input i
      left join categories c on c.name = i.category_name
    ), upsert_products as (
      insert into products (canonical_name, brand, category_id, normalized_key, updated_at)
      select canonical_name, brand, category_id, normalized_key, now()
      from product_input
      on conflict (normalized_key) do update set
        canonical_name = excluded.canonical_name,
        brand = excluded.brand,
        category_id = excluded.category_id,
        updated_at = now()
      returning id, normalized_key
    ), offer_input as (
      select pi.*, up.id as product_id
      from product_input pi
      join upsert_products up on up.normalized_key = pi.normalized_key
    ), upsert_offers as (
      insert into offers (
        store_id, product_id, source_product_name, source_url, image_url,
        regular_price, offer_price, unit_price, loyalty_required, loyalty_label,
        valid_from, valid_until, collected_at, source_hash, raw_payload, is_active
      )
      select
        ${storeId}, product_id, source_product_name, source_url, image_url,
        regular_price, offer_price, null, false, null,
        current_date, valid_until, now(), source_hash,
        raw_payload || jsonb_build_object('discount_pct', discount_pct), true
      from offer_input
      on conflict (store_id, source_hash) do update set
        product_id = excluded.product_id,
        source_product_name = excluded.source_product_name,
        source_url = excluded.source_url,
        image_url = excluded.image_url,
        regular_price = excluded.regular_price,
        offer_price = excluded.offer_price,
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until,
        collected_at = excluded.collected_at,
        raw_payload = excluded.raw_payload,
        is_active = true
      returning id, product_id, store_id, offer_price, regular_price
    )
    insert into price_history (product_id, store_id, price, regular_price, observed_at, offer_id)
    select u.product_id, u.store_id, u.offer_price, u.regular_price, now(), u.id
    from upsert_offers u
    where not exists (
      select 1 from price_history ph
      where ph.product_id = u.product_id
        and ph.store_id = u.store_id
        and ph.price = u.offer_price
        and coalesce(ph.regular_price, -1) = coalesce(u.regular_price, -1)
        and ph.observed_at > now() - interval '5 hours'
    )
  `;
  return rows.length;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!DATABASE_URL) return res.status(500).json({ ok: false, error: 'missing_database_url' });

  const sql = neon(DATABASE_URL);
  const startedAt = new Date();
  try {
    const stores = await sql`
      select s.id, s.name
      from stores s
      join supermarkets sm on sm.id = s.supermarket_id
      where sm.name = 'Super Muffato'
        and s.name ilike '%Juscelino Kubitscheck%'
        and s.is_active = true
      order by s.id
      limit 1
    `;
    if (!stores.length) throw new Error('Muffato JK store not found');
    const storeId = stores[0].id;

    let fetched = 0;
    let saved = 0;
    let pages = 0;
    let totalHeader = null;
    let complete = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const batch = await fetchPage(from, to);
      totalHeader ||= batch.totalHeader;
      const products = Array.isArray(batch.products) ? batch.products : [];
      if (!products.length) { complete = true; break; }
      fetched += products.length;
      saved += await saveBatch(sql, storeId, makeRecords(products));
      pages++;
      if (products.length < PAGE_SIZE) { complete = true; break; }
    }

    if (complete) {
      await sql`
        update offers
        set is_active = false
        where store_id = ${storeId}
          and raw_payload->>'source' = 'muffato-vtex'
          and collected_at < ${startedAt.toISOString()}::timestamptz
      `;
    }

    const counts = await sql`
      select c.name as category, count(*)::int as offers
      from offers o
      join products p on p.id = o.product_id
      left join categories c on c.id = p.category_id
      where o.store_id = ${storeId}
        and o.is_active = true
        and (o.valid_until is null or o.valid_until >= current_date)
      group by c.name
      order by offers desc, c.name
    `;

    return res.status(200).json({
      ok: true,
      source: 'Super Muffato',
      store: stores[0].name,
      fetched,
      saved,
      pages,
      complete,
      total_header: totalHeader,
      categories: counts
    });
  } catch (error) {
    console.error('collect-muffato', error);
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}
