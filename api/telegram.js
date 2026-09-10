import { neon } from '@neondatabase/serverless';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function sendTelegram(chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
  if (!r.ok) throw new Error(`Telegram sendMessage failed: ${r.status}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
  if (!BOT_TOKEN || !DATABASE_URL) return json(res, 500, { ok: false, error: 'missing_env' });

  if (WEBHOOK_SECRET) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== WEBHOOK_SECRET) return json(res, 401, { ok: false, error: 'invalid_secret' });
  }

  try {
    const update = req.body || {};
    const message = update.message || update.edited_message;
    if (!message?.chat?.id) return json(res, 200, { ok: true, ignored: true });

    const chatId = Number(message.chat.id);
    const displayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || message.from?.username || 'Telegram';
    const text = String(message.text || '').trim().toLowerCase();
    const sql = neon(DATABASE_URL);

    await sql`
      insert into telegram_users (telegram_chat_id, display_name, is_active)
      values (${chatId}, ${displayName}, true)
      on conflict (telegram_chat_id)
      do update set display_name = excluded.display_name, is_active = true
    `;

    if (text === '/start' || text === 'oi' || text === 'olá' || text === 'ola') {
      await sendTelegram(chatId,
        '🛒 <b>Promo Supermercado</b>\n\nSeu cadastro foi realizado. Vou usar este chat para enviar ofertas de supermercados de São José do Rio Preto e Mirassol.\n\nEm breve você poderá escolher categorias, favoritos e alertas de preço.'
      );
    }

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error(error);
    return json(res, 500, { ok: false, error: 'internal_error' });
  }
}
