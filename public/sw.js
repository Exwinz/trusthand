const CACHE = 'trusthand-v6'; // bump whenever the pages or clips change so nothing stale survives
const SHELL = ['/', '/index.html', '/live.html', '/manifest.json'];
// Voice prompt clips and single digits are cached up front; payment clips (and anything else under /sounds/) are cached the first time they play.
const PROMPTS = [
  'role_prompt', 'setup_step1', 'setup_step2', 'setup_step3', 'fingerprint_saved', 'verify_fingerprint', 'pin_current',
  'pin_new', 'pin_confirm', 'pin_saved', 'pin_mismatch', 'pin_wrong', 'helper_link', 'voice_on', 'delete', 'pairing_code_is',
  'type_name', 'type_your_name_first', 'enter_6_digits', 'type_helper_name', 'touch_id_removed',
  'save_failed', 'pin_save_failed', 'helper_add_failed', 'connect_failed', 'touch_id_cancelled', 'touch_id_failed', 'invalid_code', 'access_removed', 'too_many_codes', 'owner_name_required', 'helper_name_required', 'linked_to_owner', 'helper_added',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
].map((n) => `/sounds/${n}.mp3`);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await c.addAll(SHELL);
      await Promise.allSettled(PROMPTS.map((u) => c.add(u))); // a missing clip must not break the install
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Audio elements ask for byte ranges (206), which the Cache API cannot store. So: fetch the whole file,
// cache it, and answer range requests ourselves. Network first, so re-recorded clips are never stale.
function sliceRange(buf, range) {
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const size = buf.byteLength;
  let start = m && m[1] ? +m[1] : 0;
  let end = m && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(size - +m[2], 0); end = size - 1; } // suffix range
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
  });
}
async function sound(req) {
  const cache = await caches.open(CACHE);
  let res = null;
  try {
    res = await fetch(req.url, { cache: 'no-cache' }); // whole file, no Range header
    if (res.status === 200) cache.put(req.url, res.clone());
  } catch (err) { res = null; }
  if (!res || !res.ok) {
    const hit = await cache.match(req.url);
    if (!hit) return res || Response.error(); // a missing file stays an error so the page can fall back to browser speech
    res = hit;
  }
  const range = req.headers.get('range');
  return range ? sliceRange(await res.arrayBuffer(), range) : res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Never cache the payment API: money state must always be live.
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin === location.origin && url.pathname.startsWith('/sounds/')) { e.respondWith(sound(req)); return; }
  // Network first, fall back to cache so the shell opens offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (url.origin === location.origin && url.pathname !== '/sw.js') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});
