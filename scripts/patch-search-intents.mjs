import fs from 'node:fs';

const path = 'api/telegram.js';
let source = fs.readFileSync(path, 'utf8');
const start = source.indexOf('async function searchOffers(sql, term, limit = 10) {');
const end = source.indexOf('\nasync function fetchBiggestDiscounts', start);
if (start < 0 || end < 0) throw new Error('searchOffers block not found');

const replacement = `const PRODUCT_INTENTS = {
  leite: {
    accept: /(^|[^a-z])leite([^a-z]|$)/,
    reject: /(chocolate|ao leite|doce de leite|creme de leite|leite condensado|leite em po|leite po|leite fermentado|cafe com leite|bebida lactea|sabonete|desodorante|racao|alimento para gato|alimento para gatos|alimento para cao|alimento para caes|whiskas|pedigree|leite de coco|pudim)/
  },
  feijao: {
    accept: /(^|[^a-z])feijao([^a-z]|$)/,
    reject: /(tempero|caldo|sopa|farofa|mistura|sabor feijao|aroma)/
  },
  tomate: {
    accept: /(^|[^a-z])tomate([^a-z]|$)/,
    reject: /(molho|extrato|ketchup|tomate pelado|tomate seco|polpa|suco|tempero|sopa)/
  },
  uva: {
    accept: /(^|[^a-z])uva([^a-z]|$)/,
    reject: /(suco|nectar|refresco|bebida|refrigerante|vinho|espumante|gelatina|iogurte|leite fermentado|sabor uva|aroma)/
  },
  manga: {
    accept: /(^|[^a-z])manga([^a-z]|$)/,
    reject: /(suco|nectar|refresco|bebida|polpa|sorvete|iogurte|sabor manga|aroma)/
  },
  maionese: {
    accept: /(^|[^a-z])maionese([^a-z]|$)/,
    reject: /(sabor maionese|aroma|molho sabor)/
  },
  milho: {
    accept: /(^|[^a-z])milho([^a-z]|$)/,
    reject: /(farinha de milho|fuba|flocos de milho|cereal|salgadinho|pipoca|bolo|amido)/
  },
  alface: {
    accept: /(^|[^a-z])alface([^a-z]|$)/,
    reject: /(tempero|molho|sopa|semente)/
  }
};

function matchesProductIntent(term, row) {
  const intent = PRODUCT_INTENTS[term];
  if (!intent) return true;
  const haystack = normalizeSearch([row.canonical_name, row.source_product_name, row.brand].filter(Boolean).join(' '));
  return intent.accept.test(haystack) && !intent.reject.test(haystack);
}

async function searchOffers(sql, term, limit = 10) {
  const normalized = normalizeSearch(term);
  const pattern = \`%\${normalized}%\`;
  const fetchLimit = PRODUCT_INTENTS[normalized] ? Math.max(limit * 12, 120) : limit;

  const rows = await sql\`
    select o.id, o.source_product_name, o.source_url, o.regular_price, o.offer_price,
           o.loyalty_required, o.loyalty_label, o.valid_until, p.canonical_name,
           p.brand, c.name as category, s.name as store, sm.name as supermarket
    from offers o
    join stores s on s.id = o.store_id
    join supermarkets sm on sm.id = s.supermarket_id
    left join products p on p.id = o.product_id
    left join categories c on c.id = p.category_id
    where o.is_active = true
      and (o.valid_until is null or o.valid_until >= current_date)
      and (
        translate(lower(coalesce(p.canonical_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like \${pattern}
        or translate(lower(coalesce(o.source_product_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like \${pattern}
        or translate(lower(coalesce(p.brand, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like \${pattern}
      )
    order by o.offer_price desc,
      case when o.regular_price > o.offer_price
        then (o.regular_price - o.offer_price) / o.regular_price
        else 0 end desc,
      coalesce(p.canonical_name, o.source_product_name) asc
    limit \${fetchLimit}
  \`;

  return rows.filter(row => matchesProductIntent(normalized, row)).slice(0, limit);
}
`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(path, source);
console.log('search intent engine installed');
