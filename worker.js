const SECRET = 'gurogu2026';
const SUPA_URL = 'https://mgexlhhhtskpfiukzwae.supabase.co';
const SUPA_KEY = 'sb_publishable_U4i6EZZGMaIye75247dhbw_bSajlsnk';
const CACHE_TTL = 45;

// VAPID 키 (ECDSA P-256)
const VAPID_PUBLIC_KEY  = 'BN7gnLGpLS46xq7m8CiktWlZ_utpBFEYtM4qZHLeVBALvE_dFMGGRWfI_74KbAf8WHm7Z_lzVSyX2XK8cbqTGVw';
const VAPID_PRIVATE_KEY = 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgtjqtVA6UalnNRv1uIPGW7UuJBV6_hx-4npNRNGYWczyhRANCAATe4JyxqS0uOsau5vAopLVpWf7raQRRGLTOKmRy3lQQC7xP3RTBhkVnyP--CmwH_Fh5u2f5c1Usl9lyvHG6kxlc';
const VAPID_SUBJECT     = 'mailto:admin@gurogu-market.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS });

    const { pathname } = new URL(request.url);

    // ── GET /items → Supabase 캐싱 프록시 ──
    if (pathname === '/items' && request.method === 'GET') {
      const cacheKey = new Request('https://gurogu-cache.internal/items-v1');
      const cache = caches.default;
      const hit = await cache.match(cacheKey);
      if (hit) return new Response(hit.body, { ...hit, headers: { ...Object.fromEntries(hit.headers), 'X-Cache': 'HIT', ...CORS } });

      const cols = 'id,title,price,category,description,seller_name,seller_photo,sold,reserved,fcfs,created_at,thumbnail_url,photo_urls';
      const supaRes = await fetch(
        `${SUPA_URL}/rest/v1/items?select=${encodeURIComponent(cols)}&limit=200&order=created_at.desc`,
        { headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, 'Prefer': 'count=none' } }
      );
      const body = await supaRes.text();
      const res = new Response(body, {
        status: supaRes.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL}`, 'X-Cache': 'MISS', ...CORS },
      });
      if (supaRes.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    }

    // ── POST /push → 네이티브 Web Push 알림 전송 ──
    if (pathname === '/push' && request.method === 'POST') {
      try {
        const { recipientName, title, body } = await request.json();
        if (!recipientName || !title)
          return new Response(JSON.stringify({ skipped: true }), { headers: { 'Content-Type': 'application/json', ...CORS } });

        // 수신자 Web Push 구독 정보 조회
        const tokenRes = await fetch(
          `${SUPA_URL}/rest/v1/user_push_tokens?user_name=eq.${encodeURIComponent(recipientName)}&select=subscription`,
          { headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}` } }
        );
        const rows = await tokenRes.json();
        if (!rows?.length || !rows[0]?.subscription)
          return new Response(JSON.stringify({ skipped: 'no subscription' }), { headers: { 'Content-Type': 'application/json', ...CORS } });

        const subscription = rows[0].subscription;
        const payload = JSON.stringify({ title, body: body || '' });
        const pushRes = await sendWebPush(subscription, payload);
        return new Response(JSON.stringify({ status: pushRes.status }), { headers: { 'Content-Type': 'application/json', ...CORS } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } });
      }
    }

    // ── POST / → R2 이미지 업로드 ──
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
    const token = request.headers.get('X-Upload-Token');
    if (token !== SECRET) return new Response('Unauthorized', { status: 401, headers: CORS });
    try {
      const fd = await request.formData();
      const file = fd.get('file');
      const key  = fd.get('key');
      if (!file || !key) return new Response('Missing file or key', { status: 400, headers: CORS });
      await env.R2.put(key, file, { httpMetadata: { contentType: 'image/jpeg' } });
      return new Response(JSON.stringify({ url: `https://pub-637ef1d333a548be89bbf43d44e75bf7.r2.dev/${key}` }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
  },
};

/* ════════════════════════════════
   유틸리티
════════════════════════════════ */
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function b64urlEncode(data) {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

/* ════════════════════════════════
   VAPID JWT (ES256)
════════════════════════════════ */
async function createVapidJWT(endpoint) {
  const origin = new URL(endpoint).origin;
  const iat = Math.floor(Date.now() / 1000);
  const b64 = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header  = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64(JSON.stringify({ aud: origin, exp: iat + 43200, sub: VAPID_SUBJECT }));
  const unsigned = `${header}.${payload}`;

  const privKey = await crypto.subtle.importKey(
    'pkcs8', b64urlDecode(VAPID_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64urlEncode(sig)}`;
}

/* ════════════════════════════════
   RFC 8291 Web Push 암호화
════════════════════════════════ */
async function encryptWebPush(subscription, plaintext) {
  const receiverPub = b64urlDecode(subscription.keys.p256dh); // 65 bytes
  const authSecret  = b64urlDecode(subscription.keys.auth);   // 16 bytes
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // 임시 ECDH 키 쌍 생성 (발신자)
  const senderKP  = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPub = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey));

  // 수신자 공개키 import
  const receiverKey = await crypto.subtle.importKey('raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // ECDH 공유 비밀 (32 bytes)
  const sharedBytes = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderKP.privateKey, 256)
  );

  // 랜덤 salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // IKM 도출: HKDF-SHA-256(salt=auth, ikm=ecdh_secret, info="WebPush: info\x00"+receiverPub+senderPub, L=32)
  const keyInfo  = concat(new TextEncoder().encode('WebPush: info\x00'), receiverPub, senderPub);
  const sharedKey = await crypto.subtle.importKey('raw', sharedBytes, { name: 'HKDF' }, false, ['deriveBits']);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: keyInfo }, sharedKey, 256
  ));

  // CEK 도출: HKDF-SHA-256(salt=salt, ikm=ikm, info="Content-Encoding: aes128gcm\x00", L=16)
  const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const cek = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: aes128gcm\x00') },
    ikmKey, 128
  ));

  // Nonce 도출: HKDF-SHA-256(salt=salt, ikm=ikm, info="Content-Encoding: nonce\x00", L=12)
  const ikmKey2 = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const nonce = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: nonce\x00') },
    ikmKey2, 96
  ));

  // AES-128-GCM 암호화 (plaintext + 0x02 패딩 구분자)
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    concat(plaintextBytes, new Uint8Array([2]))
  ));

  // RFC 8188 헤더: salt(16) + rs(4, big-endian) + idlen(1) + senderPub(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([senderPub.length]), senderPub, ciphertext);
}

/* ════════════════════════════════
   Web Push 전송
════════════════════════════════ */
async function sendWebPush(subscription, payload) {
  const [encrypted, jwt] = await Promise.all([
    encryptWebPush(subscription, payload),
    createVapidJWT(subscription.endpoint),
  ]);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      'TTL': '86400',
    },
    body: encrypted,
  });
}
