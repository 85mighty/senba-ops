// 디자인 공유 링크: JSON → deflate(가능하면) → base64url 을 URL 해시 #d= 에 담는다. 서버 없이 기기 간 이동용.
const b64u = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const pipe = async (bytes, Stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))).arrayBuffer());

export async function encodeDesign(design) {
  const raw = new TextEncoder().encode(JSON.stringify(design));
  if (typeof CompressionStream !== 'undefined') { try { return 'z' + b64u(await pipe(raw, CompressionStream)); } catch {} }
  return 'j' + b64u(raw);
}
export async function decodeDesign(code) {
  const kind = code[0], bytes = unb64u(code.slice(1));
  const json = kind === 'z' ? new TextDecoder().decode(await pipe(bytes, DecompressionStream)) : new TextDecoder().decode(bytes);
  const d = JSON.parse(json); if (!d || typeof d !== 'object' || !d.surfaces) throw new Error('디자인 형식이 아닙니다'); return d;
}
export function shareCodeFromHash() { const m = location.hash.match(/[#&]d=([A-Za-z0-9_-]+)/); return m ? m[1] : null; }
