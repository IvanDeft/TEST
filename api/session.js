const { createHmac, timingSafeEqual } = require('node:crypto');
const COOKIE_NAME = 'orders_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(expiry, secret) {
  return createHmac('sha256', secret).update(String(expiry)).digest('base64url');
}

function cookieValue(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const prefix = `${COOKIE_NAME}=`;
  const item = cookies.find((cookie) => cookie.trim().startsWith(prefix));
  return item ? decodeURIComponent(item.trim().slice(prefix.length)) : '';
}

function validSessionToken(token, secret) {
  const [expiryText, suppliedSignature] = token.split('.');
  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000) || !suppliedSignature) return false;
  return constantTimeEqual(suppliedSignature, signature(expiry, secret));
}

function isValidSession(req) {
  const secret = process.env.SESSION_SECRET;
  return Boolean(secret && validSessionToken(cookieValue(req), secret));
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const password = process.env.ORDERS_APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) return res.status(503).json({ error: 'В Vercel не заданы ORDERS_APP_PASSWORD и SESSION_SECRET.' });

  if (req.method === 'GET') {
    return res.status(isValidSession(req) ? 200 : 401).json({ authenticated: isValidSession(req) });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Метод не поддерживается.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!constantTimeEqual(body.password || '', password)) return res.status(401).json({ error: 'Неверный пароль синхронизации.' });

  const expiry = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const value = `${expiry}.${signature(expiry, secret)}`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
  return res.status(200).json({ authenticated: true });
};

module.exports = handler;
