import { neon } from '@neondatabase/serverless';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const MENU = {
  keyboard: [
    [{ text: '🥩 Carnes' }, { text: '🥛 Laticínios' }],
    [{ text: '🥓 Frios e Embutidos' }, { text: '🥤 Bebidas' }],
    [{ text: '🍫 Doces e Chocolates' }, { text: '🛒 Mercearia' }],
    [{ text: '🥬 Hortifruti' }, { text: '❄️ Congelados' }],
    [{ text: '🔥 Maiores descontos %' }, { text: '🏆 Melhor preço' }],
    [{ text: '⭐ Favoritos' }, { text: '📝 Lista de compras' }],
    [{ text: '📋 Menu' }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

const CATEGORY_BY_TEXT = new Map([
  ['🥩 carnes', 'Carnes'], ['carnes', 'Carnes'],
  ['🥛 laticínios', 'Laticínios'], ['laticínios', 'Laticínios'], ['laticinios', 'Laticínios'],
  ['🥓 frios e embutidos', 'Frios e Embutidos'], ['frios e embutidos', 'Frios e Embutidos'],
  ['🥤 bebidas', 'Bebidas'], ['bebidas', 'Bebidas'],
  ['🍫 doces e chocolates', 'Doces e Chocolates'], ['doces e chocolates', 'Doces e Chocolates'],
  ['🛒 mercearia', 'Mercearia'], ['mercearia', 'Mercearia'],
  ['🥬 hortifruti', 'Hortifruti'], ['hortifruti', 'Hortifruti'],
  ['❄️ congelados', 'Congelados'], ['congelados', 'Congelados']
]);

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function brl(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dateBr(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d);
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function telegramApi(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Telegram ${method} failed: ${r.status} ${body}`);
  }
  return r.json().catch(() => ({}));
}

async function sendTelegram(chatId, text, replyMarkup = undefined) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramApi('sendMessage', payload);
}

async function answerCallbackQuery(callbackQueryId, text = undefined) {
  const payload = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  return telegramApi('answerCallbackQuery', payload);
}

function formatOffer(o, index = null) {
  const regular = o.regular_price ? Number(o.regular_price) : null;
  const offer = Number(o.offer_price);
  const discount = regular && regular > offer
    ? Math.round(((regular - offer) / regular) * 1000) / 10
    : null;
  const validity = dateBr(o.valid_until);
  const club = o.loyalty_required
    ? `\n🔐 <b>Preço clube:</b> ${escapeHtml(o.loyalty_label || 'sim')}`
    : '';
  const oldPrice = regular && regular > offer
    ? `\nPreço normal: <s>${brl(regular)}</s>`
    : '';
  const discountLine = discount
    ? `  •  <b>-${discount.toLocaleString('pt-BR')}%</b>`
    : '';
  const validLine = validity ? `\n📅 Válido até: ${validity}` : '';
  const link = o.source_url
    ? `\n🔗 <a href="${escapeHtml(o.source_url)}">Ver oferta</a>`
    : '';
  const prefix = index ? `${index}. ` : '';

  return `${prefix}<b>${escapeHtml(o.canonical_name || o.source_product_name)}</b>\n🏪 ${escapeHtml(o.supermarket)} — ${escapeHtml(o.store)}${oldPrice}\n💰 <b>${brl(offer)}</b>${discountLine}${club}${validLine}${link}`;
}

async function fetchOffers(sql, category = null, limit = 5) {
  if (category) {
    return sql`
      select o.id, o.source_product_name, o.source_url, o.regular_price, o.offer_price,
             o.loyalty_required, o.loyalty_label, o.valid_until, p.canonical_name,
             c.name as category, s.name as store, sm.name as supermarket
      from offers o
      join stores s on s.id = o.store_id
      join supermarkets sm on sm.id = s.supermarket_id
      left join products p on p.id = o.product_id
      left join categories c on c.id = p.category_id
      where o.is_active = true
        and c.name = ${category}
        and (o.valid_until is null or o.valid_until >= current_date)
      order by
        case when o.regular_price > o.offer_price
          then (o.regular_price - o.offer_price) / o.regular_price
          else 0 end desc,
        o.offer_price asc
      limit ${limit}
    `;
  }

  return sql`
    select o.id, o.source_product_name, o.source_url, o.regular_price, o.offer_price,
           o.loyalty_required, o.loyalty_label, o.valid_until, p.canonical_name,
           c.name as category, s.name as store, sm.name as supermarket
    from offers o
    join stores s on s.id = o.store_id
    join supermarkets sm on sm.id = s.supermarket_id
    left join products p on p.id = o.product_id
    left join categories c on c.id = p.category_id
    where o.is_active = true
      and (o.valid_until is null or o.valid_until >= current_date)
    order by
      case when o.regular_price > o.offer_price
        then (o.regular_price - o.offer_price) / o.regular_price
        else 0 end desc,
      o.offer_price asc
    limit ${limit}
  `;
}

async function searchOffers(sql, term, limit = 10) {
  const normalized = normalizeSearch(term);
  const pattern = `%${normalized}%`;

  if (normalized === 'leite') {
    return sql`
      select o.id, o.source_product_name, o.source_url, o.regular_price, o.offer_price,
             o.loyalty_required, o.loyalty_label, o.valid_until, p.canonical_name,
             c.name as category, s.name as store, sm.name as supermarket
      from offers o
      join stores s on s.id = o.store_id
      join supermarkets sm on sm.id = s.supermarket_id
      left join products p on p.id = o.product_id
      left join categories c on c.id = p.category_id
      where o.is_active = true
        and (o.valid_until is null or o.valid_until >= current_date)
        and translate(lower(coalesce(p.canonical_name, o.source_product_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') ~ '(^|[^a-z])leite([^a-z]|$)'
        and translate(lower(coalesce(p.canonical_name, o.source_product_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') !~ '(chocolate|ao leite|doce de leite|creme de leite|leite condensado|leite em po|leite po|leite fermentado|cafe com leite|bebida lactea|sabonete|desodorante|racao|alimento para gato|alimento para gatos|alimento para cao|alimento para caes|whiskas|pedigree|leite de coco|pudim)'
      order by o.offer_price desc,
        case when o.regular_price > o.offer_price
          then (o.regular_price - o.offer_price) / o.regular_price
          else 0 end desc,
        coalesce(p.canonical_name, o.source_product_name) asc
      limit ${limit}
    `;
  }

  return sql`
    select o.id, o.source_product_name, o.source_url, o.regular_price, o.offer_price,
           o.loyalty_required, o.loyalty_label, o.valid_until, p.canonical_name,
           c.name as category, s.name as store, sm.name as supermarket
    from offers o
    join stores s on s.id = o.store_id
    join supermarkets sm on sm.id = s.supermarket_id
    left join products p on p.id = o.product_id
    left join categories c on c.id = p.category_id
    where o.is_active = true
      and (o.valid_until is null or o.valid_until >= current_date)
      and (
        translate(lower(coalesce(p.canonical_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${pattern}
        or translate(lower(coalesce(o.source_product_name, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${pattern}
        or translate(lower(coalesce(p.brand, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${pattern}
      )
    order by o.offer_price desc,
      case when o.regular_price > o.offer_price
        then (o.regular_price - o.offer_price) / o.regular_price
        else 0 end desc,
      coalesce(p.canonical_name, o.source_product_name) asc
    limit ${limit}
  `;
}

async function fetchBiggestDiscounts(sql, limit = 10) {
  return sql`
    select o.id, o.source_product_name, o.source_url, o.regular_price, o.offer_price,
           o.loyalty_required, o.loyalty_label, o.valid_until, p.canonical_name,
           c.name as category, s.name as store, sm.name as supermarket,
           round((((o.regular_price - o.offer_price) / o.regular_price) * 100)::numeric, 1) as discount_pct
    from offers o
    join stores s on s.id = o.store_id
    join supermarkets sm on sm.id = s.supermarket_id
    left join products p on p.id = o.product_id
    left join categories c on c.id = p.category_id
    where o.is_active = true
      and (o.valid_until is null or o.valid_until >= current_date)
      and o.regular_price is not null
      and o.regular_price > 0
      and o.offer_price >= 0
      and o.offer_price < o.regular_price
    order by ((o.regular_price - o.offer_price) / o.regular_price) desc,
             (o.regular_price - o.offer_price) desc,
             o.offer_price asc
    limit ${limit}
  `;
}

async function sendOfferList(chatId, title, offers) {
  if (!offers.length) {
    await sendTelegram(chatId, `🔎 <b>${escapeHtml(title)}</b>\n\nNão encontrei oferta ativa para essa busca.`, MENU);
    return;
  }

  await sendTelegram(chatId, `🛒 <b>${escapeHtml(title)}</b>`, MENU);

  for (let i = 0; i < offers.length; i++) {
    const o = offers[i];
    await sendTelegram(
      chatId,
      formatOffer(o, i + 1),
      {
        inline_keyboard: [[
          { text: '🛒 Adicionar à lista', callback_data: `shopping:add:${o.id}` }
        ]]
      }
    );
  }
}

async function sendFavorites(chatId, sql, telegramUserId) {
  const rows = await sql`
    select f.id, f.keyword, f.max_price, f.min_discount_pct, p.canonical_name
    from favorites f
    left join products p on p.id = f.product_id
    where f.telegram_user_id = ${telegramUserId}
      and f.is_active = true
    order by f.created_at desc
    limit 20
  `;

  if (!rows.length) {
    await sendTelegram(
      chatId,
      '⭐ <b>Favoritos</b>\n\nVocê ainda não tem favoritos cadastrados.\n\nPara adicionar, envie:\n<code>favorito Coca-Cola Zero</code>\n<code>favorito Nutella</code>\n<code>favorito Filé Mignon</code>',
      MENU
    );
    return;
  }

  const items = rows
    .map((r, i) => `${i + 1}. ${escapeHtml(r.canonical_name || r.keyword || 'Favorito')}`)
    .join('\n');

  await sendTelegram(
    chatId,
    `⭐ <b>Seus favoritos</b>\n\n${items}\n\nPara adicionar outro, envie:\n<code>favorito nome do produto</code>`,
    MENU
  );
}

async function sendShoppingList(chatId, sql, telegramUserId) {
  const rows = await sql`
    select sli.id as list_item_id, sli.offer_id, sli.quantity,
           o.source_product_name, o.offer_price, o.valid_until,
           p.canonical_name, s.name as store, sm.name as supermarket
    from shopping_list_items sli
    join offers o on o.id = sli.offer_id
    join stores s on s.id = o.store_id
    join supermarkets sm on sm.id = s.supermarket_id
    left join products p on p.id = o.product_id
    where sli.telegram_user_id = ${telegramUserId}
      and sli.is_active = true
    order by sm.name asc, s.name asc, o.offer_price desc,
             coalesce(p.canonical_name, o.source_product_name) asc
  `;

  if (!rows.length) {
    await sendTelegram(
      chatId,
      '📝 <b>Lista de compras</b>\n\nSua lista está vazia. Pesquise um produto e toque em <b>🛒 Adicionar à lista</b>.',
      MENU
    );
    return;
  }

  await sendTelegram(chatId, '📝 <b>Lista de compras</b>\n\nProdutos separados por mercado:', MENU);

  let currentGroup = '';
  for (const row of rows) {
    const group = `${row.supermarket} — ${row.store}`;
    if (group !== currentGroup) {
      currentGroup = group;
      await sendTelegram(chatId, `🏪 <b>${escapeHtml(group)}</b>`);
    }

    const validity = dateBr(row.valid_until);
    const validLine = validity ? `\n📅 Oferta até: ${validity}` : '';
    await sendTelegram(
      chatId,
      `<b>${escapeHtml(row.canonical_name || row.source_product_name)}</b>\n💰 <b>${brl(row.offer_price)}</b>${validLine}`,
      {
        inline_keyboard: [[
          { text: '❌ Tirar da lista', callback_data: `shopping:remove:${row.offer_id}` }
        ]]
      }
    );
  }
}

async function ensureTelegramUser(sql, chatId, displayName) {
  const users = await sql`
    insert into telegram_users (telegram_chat_id, display_name, is_active)
    values (${chatId}, ${displayName}, true)
    on conflict (telegram_chat_id)
    do update set display_name = excluded.display_name, is_active = true
    returning id
  `;
  return users[0].id;
}

async function handleShoppingCallback(callbackQuery, sql) {
  const data = String(callbackQuery.data || '');
  const match = data.match(/^shopping:(add|remove):(\d+)$/);
  if (!match) return false;

  const chatId = Number(callbackQuery.message?.chat?.id || callbackQuery.from?.id);
  if (!chatId) return true;

  const displayName = [callbackQuery.from?.first_name, callbackQuery.from?.last_name]
    .filter(Boolean)
    .join(' ') || callbackQuery.from?.username || 'Telegram';
  const telegramUserId = await ensureTelegramUser(sql, chatId, displayName);
  const action = match[1];
  const offerId = Number(match[2]);

  if (action === 'add') {
    const offers = await sql`
      select o.id, coalesce(p.canonical_name, o.source_product_name) as name
      from offers o
      left join products p on p.id = o.product_id
      where o.id = ${offerId}
      limit 1
    `;

    if (!offers.length) {
      await answerCallbackQuery(callbackQuery.id, 'Oferta não encontrada.');
      return true;
    }

    await sql`
      insert into shopping_list_items (telegram_user_id, offer_id, quantity, is_active, updated_at)
      values (${telegramUserId}, ${offerId}, 1, true, now())
      on conflict (telegram_user_id, offer_id)
      do update set is_active = true, updated_at = now()
    `;

    await answerCallbackQuery(callbackQuery.id, 'Adicionado à lista.');
    await sendTelegram(
      chatId,
      `✅ <b>${escapeHtml(offers[0].name)}</b> foi adicionado à sua lista de compras.`,
      MENU
    );
    return true;
  }

  await sql`
    update shopping_list_items
    set is_active = false, updated_at = now()
    where telegram_user_id = ${telegramUserId}
      and offer_id = ${offerId}
  `;
  await answerCallbackQuery(callbackQuery.id, 'Removido da lista.');
  await sendTelegram(chatId, '❌ Item retirado da lista de compras.', MENU);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!BOT_TOKEN || !DATABASE_URL) {
    return json(res, 500, { ok: false, error: 'missing_env' });
  }

  try {
    const update = req.body || {};
    const sql = neon(DATABASE_URL);

    if (update.callback_query) {
      const handled = await handleShoppingCallback(update.callback_query, sql);
      if (!handled) await answerCallbackQuery(update.callback_query.id);
      return json(res, 200, { ok: true });
    }

    const message = update.message || update.edited_message;
    if (!message?.chat?.id) return json(res, 200, { ok: true, ignored: true });

    const chatId = Number(message.chat.id);
    const displayName = [message.from?.first_name, message.from?.last_name]
      .filter(Boolean)
      .join(' ') || message.from?.username || 'Telegram';
    const rawText = String(message.text || '').trim();
    const text = rawText.toLowerCase();
    const telegramUserId = await ensureTelegramUser(sql, chatId, displayName);

    if (
      text === '/start' || text === 'oi' || text === 'olá' || text === 'ola' ||
      text === 'menu' || text === '📋 menu'
    ) {
      await sendTelegram(
        chatId,
        '🛒 <b>Promo Supermercado</b>\n\nEscolha uma categoria ou simplesmente digite o produto que procura, por exemplo: <code>leite</code>, <code>nescau</code>, <code>macarrão</code>, <code>maionese</code>, <code>alface</code>, <code>manga</code>, <code>uva</code> ou <code>tomate</code>. Nas buscas, os resultados aparecem do maior para o menor preço, deixando os mais baratos no final da conversa.',
        MENU
      );

      if (text === '/start' || text === 'oi' || text === 'olá' || text === 'ola') {
        const top = await fetchOffers(sql, null, 1);
        if (top.length) await sendOfferList(chatId, 'Oferta real de teste', top);
      }
      return json(res, 200, { ok: true });
    }

    const category = CATEGORY_BY_TEXT.get(text);
    if (category) {
      const offers = await fetchOffers(sql, category, 5);
      await sendOfferList(chatId, `Melhores ofertas — ${category}`, offers);
      return json(res, 200, { ok: true });
    }

    if (
      text === '🔥 maiores descontos %' ||
      text === '🔥 maiores descontos' ||
      text === 'maiores descontos' ||
      text === 'maiores descontos %'
    ) {
      const offers = await fetchBiggestDiscounts(sql, 10);
      await sendOfferList(chatId, 'Maiores descontos por percentual', offers);
      return json(res, 200, { ok: true });
    }

    if (text === '🏆 melhor preço' || text === 'melhor preço' || text === 'melhor preco') {
      const offers = await sql`
        select distinct on (coalesce(p.normalized_key, o.source_product_name))
               o.id, o.source_product_name, o.source_url, o.regular_price, o.offer_price,
               o.loyalty_required, o.loyalty_label, o.valid_until, p.canonical_name,
               c.name as category, s.name as store, sm.name as supermarket
        from offers o
        join stores s on s.id = o.store_id
        join supermarkets sm on sm.id = s.supermarket_id
        left join products p on p.id = o.product_id
        left join categories c on c.id = p.category_id
        where o.is_active = true
          and (o.valid_until is null or o.valid_until >= current_date)
        order by coalesce(p.normalized_key, o.source_product_name), o.offer_price asc
        limit 5
      `;
      await sendOfferList(chatId, 'Melhor preço por produto', offers);
      return json(res, 200, { ok: true });
    }

    if (text === '⭐ favoritos' || text === 'favoritos') {
      await sendFavorites(chatId, sql, telegramUserId);
      return json(res, 200, { ok: true });
    }

    if (
      text === '📝 lista de compras' || text === 'lista de compras' ||
      text === 'lista compras' || text === 'minha lista'
    ) {
      await sendShoppingList(chatId, sql, telegramUserId);
      return json(res, 200, { ok: true });
    }

    if (text.startsWith('favorito ')) {
      const keyword = rawText.slice(rawText.indexOf(' ') + 1).trim();
      if (keyword.length < 2) {
        await sendTelegram(
          chatId,
          'Digite o produto depois de <code>favorito</code>. Ex.: <code>favorito Nutella</code>',
          MENU
        );
        return json(res, 200, { ok: true });
      }

      const existing = await sql`
        select id
        from favorites
        where telegram_user_id = ${telegramUserId}
          and lower(keyword) = lower(${keyword})
        limit 1
      `;

      if (existing.length) {
        await sql`update favorites set is_active = true where id = ${existing[0].id}`;
      } else {
        await sql`
          insert into favorites (telegram_user_id, keyword, is_active)
          values (${telegramUserId}, ${keyword}, true)
        `;
      }

      await sendTelegram(
        chatId,
        `⭐ Favorito cadastrado: <b>${escapeHtml(keyword)}</b>\n\nVou usar esse nome para localizar ofertas desse produto.`,
        MENU
      );
      return json(res, 200, { ok: true });
    }

    if (rawText.length >= 2 && rawText.length <= 80) {
      const offers = await searchOffers(sql, rawText, 10);
      await sendOfferList(chatId, `Busca: ${rawText} — maior para menor preço`, offers);
      return json(res, 200, { ok: true });
    }

    await sendTelegram(
      chatId,
      'Digite o nome de um produto, por exemplo <code>leite</code>, ou use os botões do menu.',
      MENU
    );
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error(error);
    return json(res, 500, { ok: false, error: 'internal_error' });
  }
}
