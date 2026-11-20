require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const { createAuthenticatedClient, isPendingGrant } = require('@interledger/open-payments');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const toUrl = (u) => (u || '').trim().replace(/^\$/, 'https://');
const OWNER_URL = toUrl(process.env.OWNER_WALLET_ADDRESS);
const SELLER_URL = toUrl(process.env.SELLER_WALLET_ADDRESS);

// ---------- Wallet pointer normalization ----------
// "$ilp.interledger-test.dev/ade", "ilp.interledger-test.dev/ade" and the short handle "ade" all become
// "https://ilp.interledger-test.dev/ade". Hosts are checked against an allow-list so the server can never be
// pointed at an arbitrary URL (SSRF): the default wallet host, the hosts of OWNER/SELLER_WALLET_ADDRESS, and
// anything listed in ALLOWED_WALLET_HOSTS (comma separated).
const DEFAULT_WALLET_HOST = (process.env.DEFAULT_WALLET_HOST || 'ilp.interledger-test.dev').toLowerCase();
class WalletInputError extends Error {}
function normalizePointer(raw) {
  let v = String(raw ?? '').trim().replace(/^\$/, '');
  if (!v || /\s/.test(v)) return '';
  if (!/^https?:\/\//i.test(v)) v = v.includes('/') ? 'https://' + v : `https://${DEFAULT_WALLET_HOST}/${v}`;
  try {
    const u = new URL(v);
    const path = u.pathname.replace(/\/+$/, '');
    if (!/^\/[A-Za-z0-9._~%-]+(\/[A-Za-z0-9._~%-]+)*$/.test(path)) return '';
    return 'https://' + u.host.toLowerCase() + path;
  } catch (e) { return ''; }
}
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; } };
const ALLOWED_WALLET_HOSTS = new Set([
  DEFAULT_WALLET_HOST, hostOf(OWNER_URL), hostOf(SELLER_URL),
  ...(process.env.ALLOWED_WALLET_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()),
].filter(Boolean));
function resolveWallet(raw, fallback) {
  if (!String(raw ?? '').trim()) return fallback;
  const url = normalizePointer(raw);
  if (!url) throw new WalletInputError('That wallet address is not valid. Use $ilp.interledger-test.dev/name, or just the name.');
  if (!ALLOWED_WALLET_HOSTS.has(hostOf(url))) throw new WalletInputError(`Wallet host ${hostOf(url)} is not allowed.`);
  return url;
}

// ---------- PNG app icons (zero dependencies: fs + zlib) ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
// Shield outline in 0..1 space, scaled about its centre by s.
const inShield = (x, y, s) => {
  x = 0.5 + (x - 0.5) / s;
  y = 0.52 + (y - 0.52) / s;
  if (y < 0.18 || y > 0.86) return false;
  if (y <= 0.5) return Math.abs(x - 0.5) <= 0.29;
  return Math.abs(x - 0.5) <= 0.29 * Math.cos(((y - 0.5) / 0.36) * (Math.PI / 2));
};
function iconColor(x, y) {
  if (!inShield(x, y, 1)) return [6, 95, 70];            // emerald background
  if (!inShield(x, y, 0.86)) return [245, 158, 11];      // gold shield border
  const dx = x - 0.5, dy = y - 0.37;
  if (dx * dx + dy * dy <= 0.075 * 0.075) return [255, 255, 255]; // white figure
  const u = (x - 0.5) / 0.2;                              // white cupped hand
  if (Math.abs(u) <= 1 && Math.abs(y - (0.5 + 0.13 * (1 - u * u))) <= 0.025) return [255, 255, 255];
  return [6, 95, 70];
}
function makeIcon(size) {
  const stride = size * 3 + 1, SS = 2, raw = Buffer.alloc(stride * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = iconColor((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = py * stride + 1 + px * 3, n = SS * SS;
      raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function ensureIcons() {
  fs.mkdirSync('public', { recursive: true });
  for (const size of [192, 512]) {
    const file = path.join('public', `icon-${size}.png`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, makeIcon(size)); // delete the file to regenerate
  }
}
ensureIcons();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ---------- Open Payments client (lazy, cached) ----------
// The authenticated client always uses KEY_ID + the private key registered for OWNER_WALLET_ADDRESS.
// It requests grants against whatever sender/receiver wallet the frontend names (see walletFor).
let ctxPromise;
function getCtx() {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const client = await createAuthenticatedClient({
        walletAddressUrl: OWNER_URL,
        privateKey: process.env.PRIVATE_KEY_PATH || './private.key',
        keyId: process.env.KEY_ID,
      });
      return { client };
    })().catch((e) => { ctxPromise = null; throw e; });
  }
  return ctxPromise;
}
const walletCache = new Map();
async function walletFor(url) {
  const hit = walletCache.get(url);
  if (hit && hit.exp > Date.now()) return hit.wallet;
  const { client } = await getCtx();
  let wallet;
  try { wallet = await client.walletAddress.get({ url }); }
  catch (e) {
    console.error('wallet lookup failed:', url, e.message);
    throw new WalletInputError(`Wallet not found: $${url.replace(/^https:\/\//, '')}`);
  }
  walletCache.set(url, { wallet, exp: Date.now() + 5 * 60 * 1000 });
  return wallet;
}

// ---------- In-memory errand session ----------
// status: NONE | PENDING | ACTIVE | REVOKED | AUTO_LOCKED
let session = { status: 'NONE', cap: 0, spent: 0, autoLock: true, token: null, manageUrl: null, scale: 2, senderUrl: OWNER_URL, receiverUrl: SELLER_URL, assetCode: 'EUR' };
let pending = null; // interactive grant waiting for owner approval
let lastReceipt = null; // most recent successful payment
let lastBlocked = null; // most recent rejected payment

// Owner account + helper pairing (in-memory, demo scope)
const MAX_HELPERS = 10;
let ownerAccount = { name: '', walletAddress: '', pairCode: '', isSetup: false };
let helpers = []; // { id, name, linkedAt, status: PENDING | ACTIVE | REVOKED }
// The pairing code is a secret: it is never included in /api/status.
const publicOwner = () => ({ name: ownerAccount.name, walletAddress: ownerAccount.walletAddress, isSetup: ownerAccount.isSetup });

const eur = (minor) => minor / 10 ** session.scale;
const view = () => ({
  status: session.status,
  cap: eur(session.cap),
  spent: eur(session.spent),
  remaining: eur(Math.max(session.cap - session.spent, 0)),
  autoLock: session.autoLock,
  currency: session.assetCode || 'EUR',
  sender: '$' + session.senderUrl.replace(/^https:\/\//, ''),
  seller: '$' + session.receiverUrl.replace(/^https:\/\//, ''),
  lastReceipt,
  lastBlocked,
  ownerAccount: publicOwner(),
  helpers,
});
const wholeEuro = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

async function revokeToken() {
  if (!session.token || !session.manageUrl) return;
  const { client } = await getCtx();
  try {
    await client.token.revoke({ url: session.manageUrl, accessToken: session.token });
  } catch (e) {
    console.error('Token revoke failed:', e.message); // session is still locked locally
  }
  session.token = null;
}

// ---------- POST /api/grant ----------
app.post('/api/grant', async (req, res) => {
  try {
    const cap = wholeEuro(req.body.cap, 1, 50);
    const hours = wholeEuro(req.body.durationHours ?? 24, 1, 168);
    const autoLock = req.body.autoLock !== false;
    if (!cap) return res.status(400).json({ error: 'Cap must be a whole number from 1 to 50 EUR.' });
    if (!hours) return res.status(400).json({ error: 'Duration must be 1 to 168 hours.' });

    const senderUrl = resolveWallet(req.body.senderWalletAddress, OWNER_URL);
    const receiverUrl = resolveWallet(req.body.receiverWalletAddress, SELLER_URL);
    const { client } = await getCtx();
    const owner = await walletFor(senderUrl);   // the wallet the Owner is granting spending rights on
    await walletFor(receiverUrl);               // fail fast if the recipient does not exist
    if (session.token) await revokeToken(); // replace any previous errand grant
    const minor = cap * 10 ** owner.assetScale;
    const nonce = crypto.randomUUID();
    const start = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const grant = await client.grant.request({ url: owner.authServer }, {
      access_token: {
        access: [{
          type: 'outgoing-payment',
          actions: ['create', 'read', 'list'],
          identifier: owner.id,
          limits: {
            debitAmount: { value: String(minor), assetCode: owner.assetCode, assetScale: owner.assetScale },
            interval: `R1/${start}/PT${hours}H`,
          },
        }],
      },
      interact: { start: ['redirect'], finish: { method: 'redirect', uri: `${BASE_URL}/api/grant/callback`, nonce } },
    });

    lastBlocked = null;
    session = { status: 'PENDING', cap: minor, spent: 0, autoLock, token: null, manageUrl: null, scale: owner.assetScale, senderUrl, receiverUrl, assetCode: owner.assetCode };

    if (isPendingGrant(grant)) {
      pending = { nonce, continueUri: grant.continue.uri, continueToken: grant.continue.access_token.value };
      return res.json({ ...view(), redirectUrl: grant.interact.redirect });
    }
    // Non-interactive grant (some wallets): finalized immediately.
    session.status = 'ACTIVE';
    session.token = grant.access_token.value;
    session.manageUrl = grant.access_token.manage;
    res.json(view());
  } catch (e) {
    if (e instanceof WalletInputError) return res.status(400).json({ error: e.message });
    console.error('grant error:', e);
    res.status(502).json({ error: 'Could not create grant', detail: e.message });
  }
});

// Owner is redirected here after approving in the wallet.
app.get('/api/grant/callback', async (req, res) => {
  const done = (ok) => res.send(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:3rem">
    <h2>${ok ? 'Approved. You can close this window.' : 'Approval failed. Please try again.'}</h2>
    <script>try{window.opener&&window.opener.postMessage({trusthand:'${ok ? 'granted' : 'failed'}'},'*')}catch(e){}
    setTimeout(()=>{window.close();location.href='/'},900)</script>`);
  try {
    if (!pending || !req.query.interact_ref) return done(false);
    const { client } = await getCtx();
    const cont = await client.grant.continue(
      { url: pending.continueUri, accessToken: pending.continueToken },
      { interact_ref: req.query.interact_ref },
    );
    if (isPendingGrant(cont)) return done(false);
    session.status = 'ACTIVE';
    session.token = cont.access_token.value;
    session.manageUrl = cont.access_token.manage;
    pending = null;
    done(true);
  } catch (e) {
    console.error('callback error:', e);
    session.status = 'NONE';
    done(false);
  }
});

function reject(res, code, reason, amount, extra = {}) {
  lastBlocked = { reason, amountEur: amount, timestamp: new Date().toISOString() };
  return res.status(code).json({ ok: false, reason, ...extra, ...view() });
}

// ---------- POST /api/pay ----------
app.post('/api/pay', async (req, res) => {
  const amount = wholeEuro(req.body.amount, 1, 50);
  if (!amount) return res.status(400).json({ error: 'Amount must be a whole number from 1 to 50 EUR.' });

  if (req.body.helperId !== undefined) { // helper devices identify themselves; removed helpers stay blocked even after Undo Block
    const h = helpers.find((x) => x.id === req.body.helperId);
    if (!h || h.status !== 'ACTIVE') return reject(res, 403, 'REVOKED', amount);
  }
  if (session.status === 'AUTO_LOCKED') return reject(res, 403, 'AUTO_LOCKED', amount);
  if (session.status !== 'ACTIVE' || !session.token) return reject(res, 403, 'REVOKED', amount);
  const minor = amount * 10 ** session.scale;
  if (session.spent + minor > session.cap) return reject(res, 403, 'LIMIT_EXCEEDED', amount);

  let receiverUrl;
  try {
    if (req.body.senderWalletAddress && resolveWallet(req.body.senderWalletAddress, session.senderUrl) !== session.senderUrl) {
      return reject(res, 400, 'INVALID_WALLET', amount, { error: 'Sender wallet does not match the approved grant.' });
    }
    receiverUrl = resolveWallet(req.body.receiverWalletAddress, session.receiverUrl);
  } catch (e) {
    return reject(res, 400, 'INVALID_WALLET', amount, { error: e.message });
  }

  try {
    const { client } = await getCtx();
    const owner = await walletFor(session.senderUrl);
    const seller = await walletFor(receiverUrl);

    // 1. Receiver: incoming payment on the seller's wallet
    const inGrant = await client.grant.request({ url: seller.authServer }, {
      access_token: { access: [{ type: 'incoming-payment', actions: ['read', 'create', 'complete'] }] },
    });
    const incoming = await client.incomingPayment.create(
      { url: seller.resourceServer, accessToken: inGrant.access_token.value },
      { walletAddress: seller.id },
    );

    // 2. Quote from the owner's EUR wallet (fixed debit amount)
    const qGrant = await client.grant.request({ url: owner.authServer }, {
      access_token: { access: [{ type: 'quote', actions: ['create', 'read'] }] },
    });
    const quote = await client.quote.create(
      { url: owner.resourceServer, accessToken: qGrant.access_token.value },
      {
        method: 'ilp',
        walletAddress: owner.id,
        receiver: incoming.id,
        debitAmount: { value: String(minor), assetCode: owner.assetCode, assetScale: owner.assetScale },
      },
    );

    // 3. Outgoing payment using the capped errand grant
    const payment = await client.outgoingPayment.create(
      { url: owner.resourceServer, accessToken: session.token },
      { walletAddress: owner.id, quoteId: quote.id, metadata: { description: 'TrustHand errand' } },
    );

    session.spent += Number(payment.debitAmount?.value ?? minor);

    // Single-Errand Auto-Lock: kill the token right away
    let autoLocked = false;
    if (session.autoLock) {
      await revokeToken();
      session.status = 'AUTO_LOCKED';
      autoLocked = true;
    }
    const rx = payment.receiveAmount || quote.receiveAmount;
    lastReceipt = {
      txId: String(payment.id).split('/').pop(),
      amountEur: amount,
      settledUsd: rx ? Number(rx.value) / 10 ** rx.assetScale : null,
      seller: '$' + receiverUrl.replace(/^https:\/\//, ''),
      remainingEur: view().remaining,
      autoLocked,
      timestamp: new Date().toISOString(),
    };
    lastBlocked = null;
    res.json({ ok: true, autoLocked, paymentId: payment.id, amount, ...view() });
  } catch (e) {
    if (e instanceof WalletInputError) return reject(res, 400, 'INVALID_WALLET', amount, { error: e.message });
    console.error('pay error:', e.message);
    const text = `${e.description || ''} ${e.message || ''}`.toLowerCase();
    if (e.status === 401 || /invalid token|revoked/.test(text)) {
      session.status = 'REVOKED';
      return reject(res, 403, 'REVOKED', amount);
    }
    if (e.status === 403 || /limit|exceed|insufficient/.test(text)) {
      return reject(res, 403, 'LIMIT_EXCEEDED', amount);
    }
    reject(res, 502, 'PAYMENT_FAILED', amount, { error: e.message });
  }
});

// ---------- POST /api/revoke ----------
app.post('/api/revoke', async (_req, res) => {
  await revokeToken();
  pending = null;
  session.status = 'REVOKED';
  res.json({ ok: true, ...view() });
});

// ---------- Owner setup and helper pairing ----------
const cleanName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const linkFails = new Map(); // ip -> { n, until }

app.post('/api/owner/setup', (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Owner name is required.' });
  let walletAddress;
  try { walletAddress = resolveWallet(req.body.walletAddress, OWNER_URL); } catch (e) { return res.status(400).json({ error: e.message }); }
  const names = Array.isArray(req.body.helperNames) ? req.body.helperNames.map(cleanName).filter(Boolean) : [];
  // First setup generates the code; later edits keep it unless regenerate is requested.
  const pairCode = !ownerAccount.pairCode || req.body.regenerate === true ? newCode() : ownerAccount.pairCode;
  ownerAccount = { name, walletAddress, pairCode, isSetup: true };
  for (const n of names) {
    const existing = helpers.find((h) => sameName(h.name, n));
    if (!existing) {
      if (helpers.length < MAX_HELPERS) helpers.push({ id: crypto.randomUUID(), name: n, linkedAt: null, status: 'PENDING' });
    } else if (existing.status === 'REVOKED') { // owner re-invites a removed helper
      existing.status = 'PENDING';
      existing.linkedAt = null;
    }
  }
  res.json({ ownerAccount, helpers });
});

app.post('/api/helper/link', (req, res) => {
  const now = Date.now();
  const fails = linkFails.get(req.ip) || { n: 0, until: 0 };
  if (fails.until > now) return res.status(429).json({ error: 'Too many wrong codes. Wait a minute and try again.' });
  const code = String(req.body.pairCode ?? '').replace(/[\s-]/g, '');
  if (!ownerAccount.isSetup || code !== ownerAccount.pairCode) {
    fails.n += 1;
    if (fails.n >= 5) { fails.n = 0; fails.until = now + 60000; }
    linkFails.set(req.ip, fails);
    return res.status(403).json({ error: 'Invalid pairing code' });
  }
  linkFails.delete(req.ip);
  const name = cleanName(req.body.helperName);
  if (!name) return res.status(400).json({ error: 'Helper name is required.' });
  let helper = helpers.find((h) => sameName(h.name, name));
  if (helper && helper.status === 'REVOKED') return res.status(403).json({ error: 'Access was removed by the owner.' });
  if (!helper) {
    if (helpers.length >= MAX_HELPERS) return res.status(400).json({ error: 'Too many helpers linked.' });
    helper = { id: crypto.randomUUID(), name, linkedAt: null, status: 'PENDING' };
    helpers.push(helper);
  }
  helper.status = 'ACTIVE';
  helper.linkedAt = new Date().toISOString();
  res.json({ helper, ownerName: ownerAccount.name });
});

app.post('/api/owner/helper-revoke', async (req, res) => {
  const helper = helpers.find((h) => h.id === req.body.helperId);
  if (!helper) return res.status(404).json({ error: 'Helper not found' });
  helper.status = 'REVOKED';
  if (session.status === 'ACTIVE' && session.token) { // one shared grant: kill it so access ends instantly
    try { await revokeToken(); } catch (e) { console.error('helper revoke:', e.message); }
    session.token = null;
    session.status = 'REVOKED';
  }
  if (ownerAccount.isSetup) ownerAccount.pairCode = newCode(); // rotate so a removed helper cannot re-link
  res.json({ ok: true, helper, helpers, pairCode: ownerAccount.pairCode, ...view() });
});

// ---------- GET /api/status ----------
app.get('/api/status', (_req, res) => res.json(view()));

app.listen(PORT, () => {
  console.log(`TrustHand running on ${BASE_URL}`);
  getCtx().then(() => walletFor(OWNER_URL)).then(() => console.log('Open Payments client ready')).catch((e) => console.error('Open Payments init failed:', e.message));
});
