const { createHmac, timingSafeEqual } = require('node:crypto');
const REPOSITORY = 'IvanDeft/TEST';
const FILE_PATH = 'orders.xml';
const BRANCH = 'master';
const API_URL = `https://api.github.com/repos/${REPOSITORY}/contents/${FILE_PATH}`;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function serializeOrders(input) {
  if (!Array.isArray(input) || input.length > 500) throw new Error('Ожидался список не более чем из 500 заказов.');
  const ids = new Set();
  const records = input.map((order) => {
    const id = String(order?.id || '');
    const name = String(order?.text || '').trim();
    const start = String(order?.start || '');
    const end = String(order?.end || '');
    if (!id || id.length > 120 || ids.has(id)) throw new Error('У каждого заказа должен быть уникальный идентификатор.');
    if (!name || name.length > 100) throw new Error('Название заказа должно содержать от 1 до 100 символов.');
    if (!validDate(start) || !validDate(end) || end < start) throw new Error('Проверьте даты начала и окончания заказа.');
    ids.add(id);
    return `  <order id="${escapeXml(id)}" start="${start}" end="${end}" done="${order.done === true ? 'true' : 'false'}">\n    <name>${escapeXml(name)}</name>\n  </order>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<orders version="1">\n${records.length ? `${records.join('\n')}\n` : '  <!-- Список заказов пока пуст. -->\n'}</orders>\n`;
}

function validSession(req) {
  const secret = process.env.SESSION_SECRET;
  const rawCookie = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('orders_session='));
  if (!secret || !rawCookie) return false;
  const token = decodeURIComponent(rawCookie.slice('orders_session='.length));
  const [expiryText, suppliedSignature] = token.split('.');
  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000) || !suppliedSignature) return false;
  const expected = createHmac('sha256', secret).update(String(expiry)).digest('base64url');
  const left = Buffer.from(suppliedSignature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Метод не поддерживается.' });
  }

  const token = process.env.GITHUB_TOKEN;
  const headers = githubHeaders(token);

  if (req.method === 'GET') {
    try {
      const response = await fetch(`${API_URL}?ref=${BRANCH}`, { headers });
      if (!response.ok) return res.status(502).json({ error: 'Не удалось прочитать orders.xml из GitHub.' });
      const file = await response.json();
      const xml = Buffer.from(file.content.replace(/\\s/g, ''), 'base64').toString('utf8');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.status(200).send(xml);
    } catch {
      return res.status(502).json({ error: 'GitHub временно недоступен.' });
    }
  }

  if (!token) return res.status(503).json({ error: 'В Vercel не задан GITHUB_TOKEN.' });
  if (!validSession(req)) return res.status(401).json({ error: 'Требуется авторизация синхронизации.' });

  let xml;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    xml = serializeOrders(body?.orders);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Некорректный запрос.' });
  }

  try {
    const currentResponse = await fetch(`${API_URL}?ref=${BRANCH}`, { headers });
    if (!currentResponse.ok) return res.status(502).json({ error: 'Не удалось получить текущую версию orders.xml.' });
    const current = await currentResponse.json();
    const updateResponse = await fetch(`${API_URL}?ref=${BRANCH}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update orders from calendar',
        content: Buffer.from(xml, 'utf8').toString('base64'),
        sha: current.sha,
        branch: BRANCH,
      }),
    });
    if (updateResponse.status === 409 || updateResponse.status === 422) {
      return res.status(409).json({ error: 'Файл был изменён параллельно. Повторите сохранение.' });
    }
    if (!updateResponse.ok) return res.status(502).json({ error: 'GitHub отклонил обновление orders.xml. Проверьте GITHUB_TOKEN и его Contents: write.' });
    const result = await updateResponse.json();
    return res.status(200).json({ ok: true, commit: result.commit?.sha || null });
  } catch {
    return res.status(502).json({ error: 'Не удалось записать orders.xml в GitHub.' });
  }
};
