/* InstaClone frontend — vanilla JS single-page app */
(() => {
'use strict';

// ============================================================ STATE & HELPERS
const S = { me: null, token: localStorage.getItem('ic_token'), unread: 0, unreadMsgs: 0, routeId: 0, chatTimer: null };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : Number(n).toLocaleString();
const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;

function ago(ts, long = false) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  const units = [[31536000, 'y', 'year'], [604800, 'w', 'week'], [86400, 'd', 'day'], [3600, 'h', 'hour'], [60, 'm', 'minute'], [1, 's', 'second']];
  for (const [sec, sh, lg] of units) {
    if (s >= sec) { const v = Math.floor(s / sec); return long ? `${v} ${lg}${v > 1 ? 's' : ''} ago` : `${v}${sh}`; }
  }
  return long ? 'just now' : 'now';
}

const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#dbdbdb"/><circle cx="50" cy="40" r="18" fill="#fff"/><path d="M14 92c4-20 18-30 36-30s32 10 36 30" fill="#fff"/></svg>`);
const av = u => (u && u.avatar) || DEFAULT_AVATAR;
const avatar = (u, size = 32, cls = '') => `<img class="avatar ${cls}" src="${esc(av(u))}" width="${size}" height="${size}" style="width:${size}px;height:${size}px" alt="${esc(u?.username)}'s profile picture" loading="lazy">`;

function richText(t) {
  return esc(t)
    .replace(/(^|\s)#([\w\u00C0-\uFFFF]+)/g, '$1<a class="tag" href="#/explore">#$2</a>')
    .replace(/(^|\s)@([a-z0-9._]{3,30})/gi, '$1<a class="tag" href="#/u/$2">@$2</a>');
}

function toast(msg, ms = 2600) {
  $$('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'include' };
  if (S.token) opts.headers.Authorization = 'Bearer ' + S.token;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { }
  if (res.status === 401 && S.me && !url.includes('/login')) { logoutLocal(); throw new Error(data.error || 'Please log in'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ============================================================ ICONS
const I = {
  home: f => f ? `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M22 23h-6.001a1 1 0 0 1-1-1v-5.455a2.997 2.997 0 1 0-5.993 0V22a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V11.543a1.002 1.002 0 0 1 .31-.724l10-9.543a1.001 1.001 0 0 1 1.38 0l10 9.543a1.002 1.002 0 0 1 .31.724V22a1 1 0 0 1-1 1Z" fill="currentColor"/></svg>`
    : `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M9.005 16.545a2.997 2.997 0 0 1 2.997-2.997A2.997 2.997 0 0 1 15 16.545V22h7V11.543L12 2 2 11.543V22h7.005Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2"/></svg>`,
  search: f => `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M19 10.5A8.5 8.5 0 1 1 10.5 2a8.5 8.5 0 0 1 8.5 8.5Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${f ? 3 : 2}"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${f ? 3 : 2}" x1="16.511" x2="22" y1="16.511" y2="22"/></svg>`,
  explore: f => f ? `<svg width="24" height="24" viewBox="0 0 24 24"><path d="m13.173 13.164 1.491-3.829-3.83 1.49ZM12.001.5a11.5 11.5 0 1 0 11.5 11.5A11.513 11.513 0 0 0 12.001.5Zm5.35 7.443-2.478 6.369a1 1 0 0 1-.57.569l-6.36 2.47a1 1 0 0 1-1.294-1.294l2.48-6.369a1 1 0 0 1 .57-.569l6.359-2.47a1 1 0 0 1 1.294 1.294Z" fill="currentColor"/></svg>`
    : `<svg width="24" height="24" viewBox="0 0 24 24"><polygon fill="none" points="13.941 13.953 7.581 16.424 10.06 10.056 16.42 7.585 13.941 13.953" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><polygon fill-rule="evenodd" fill="currentColor" points="10.06 10.056 13.949 13.945 7.581 16.424 10.06 10.056"/><circle cx="12.001" cy="12.005" fill="none" r="10.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
  send: (f, s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><line fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2" x1="22" x2="9.218" y1="3" y2="10.083"/><polygon fill="${f ? 'currentColor' : 'none'}" points="11.698 20.334 22 3.001 2 3.001 9.218 10.084 11.698 20.334" stroke="currentColor" stroke-linejoin="round" stroke-width="2"/></svg>`,
  heart: (f, s = 24) => f ? `<svg width="${s}" height="${s}" viewBox="0 0 48 48"><path fill="#ff3040" d="M34.6 3.1c-4.5 0-7.9 1.8-10.6 5.6-2.7-3.7-6.1-5.5-10.6-5.5C6 3.1 0 9.6 0 17.6c0 7.3 5.4 12 10.6 16.5.6.5 1.3 1.1 1.9 1.7l2.3 2c4.4 3.9 6.6 5.9 7.6 6.5.5.3 1.1.5 1.6.5s1.1-.2 1.6-.5c1-.6 2.8-2.2 7.8-6.8l2-1.8c.7-.6 1.3-1.2 2-1.7C42.7 29.6 48 25 48 17.6c0-8-6-14.5-13.4-14.5z"/></svg>`
    : `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122c0 3.072-2.652 4.959-5.197 7.222-2.512 2.243-3.865 3.469-4.303 3.752-.477-.309-2.143-1.823-4.303-3.752C5.141 14.072 2.5 12.167 2.5 9.122a4.989 4.989 0 0 1 4.708-5.218 4.21 4.21 0 0 1 3.675 1.941c.84 1.175.98 1.763 1.12 1.763s.278-.588 1.11-1.766a4.17 4.17 0 0 1 3.679-1.938m0-2a6.04 6.04 0 0 0-4.797 2.127 6.052 6.052 0 0 0-4.787-2.127A6.985 6.985 0 0 0 .5 9.122c0 3.61 2.55 5.827 5.015 7.97.283.246.569.494.853.747l1.027.918a44.998 44.998 0 0 0 3.518 3.018 2 2 0 0 0 2.174 0 45.263 45.263 0 0 0 3.626-3.115l.922-.824c.293-.26.59-.519.885-.774 2.334-2.025 4.98-4.32 4.98-7.94a6.985 6.985 0 0 0-6.708-7.218Z" fill="currentColor"/></svg>`,
  create: () => `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M2 12v3.45c0 2.849.698 4.005 1.606 4.944.94.909 2.098 1.608 4.946 1.608h6.896c2.848 0 4.006-.7 4.946-1.608C21.302 19.455 22 18.3 22 15.45V8.552c0-2.849-.698-4.006-1.606-4.945C19.454 2.7 18.296 2 15.448 2H8.552c-2.848 0-4.006.699-4.946 1.607C2.698 4.547 2 5.703 2 8.552Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6.545" x2="17.455" y1="12.001" y2="12.001"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12.003" x2="12.003" y1="6.545" y2="17.455"/></svg>`,
  comment: (s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="2"/></svg>`,
  save: f => `<svg width="24" height="24" viewBox="0 0 24 24"><polygon fill="${f ? 'currentColor' : 'none'}" points="20 21 12 13.44 4 21 4 3 20 3 20 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
  more: () => `<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></svg>`,
  menu: () => `<svg width="24" height="24" viewBox="0 0 24 24"><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" x1="3" x2="21" y1="4" y2="4"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" x1="3" x2="21" y1="12" y2="12"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" x1="3" x2="21" y1="20" y2="20"/></svg>`,
  grid: () => `<svg width="12" height="12" viewBox="0 0 24 24"><rect fill="none" height="18" stroke="currentColor" stroke-width="2" width="18" x="3" y="3"/><line stroke="currentColor" stroke-width="2" x1="9.015" x2="9.015" y1="3" y2="21"/><line stroke="currentColor" stroke-width="2" x1="14.985" x2="14.985" y1="3" y2="21"/><line stroke="currentColor" stroke-width="2" x1="21" x2="3" y1="9.015" y2="9.015"/><line stroke="currentColor" stroke-width="2" x1="21" x2="3" y1="14.985" y2="14.985"/></svg>`,
  savedSm: () => `<svg width="12" height="12" viewBox="0 0 24 24"><polygon fill="none" points="20 21 12 13.44 4 21 4 3 20 3 20 21" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
  close: (s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><polyline fill="none" points="20.643 3.357 12 12 3.353 20.647" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" x1="20.649" x2="3.354" y1="20.649" y2="3.354"/></svg>`,
  back: () => `<svg width="24" height="24" viewBox="0 0 24 24"><polyline points="16.5 3 7.5 12 16.5 21" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
  camera: () => `<svg width="34" height="34" viewBox="0 0 24 24"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.6l1.4-2h7l1.4 2h1.6A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  media: () => `<svg width="96" height="77" viewBox="0 0 97.6 77.3"><path d="M16.3 24h.3c2.8-.2 4.9-2.6 4.8-5.4-.2-2.8-2.6-4.9-5.4-4.8s-4.9 2.6-4.8 5.4c.1 2.7 2.4 4.8 5.1 4.8zm-2.4-7.2c.5-.6 1.3-1 2.1-1h.2c1.7 0 3.1 1.4 3.1 3.1 0 1.7-1.4 3.1-3.1 3.1-1.7 0-3.1-1.4-3.1-3.1 0-.8.3-1.5.8-2.1z" fill="currentColor"/><path d="M84.7 18.4 58 16.9l-.2-3c-.3-5.7-5.2-10.1-11-9.8L12.9 6c-5.7.3-10.1 5.3-9.8 11L5 51v.8c.7 5.2 5.1 9.1 10.3 9.1h.6l21.7-1.2v.6c-.3 5.7 4 10.7 9.8 11l34 2h.6c5.5 0 10.1-4.3 10.4-9.8l2-34c.4-5.8-4-10.7-9.7-11.1zM7.2 10.8C8.7 9.1 10.8 8.1 13 8l34-1.9c4.6-.3 8.6 3.3 8.9 7.9l.2 2.8-5.3-.3c-5.7-.3-10.7 4-11 9.8l-.6 9.5-9.5 10.7c-.2.3-.6.4-1 .5-.4 0-.7-.1-1-.4l-7.8-7c-1.4-1.3-3.5-1.1-4.8.3L7 49 5.2 17c-.2-2.3.6-4.5 2-6.2zm8.7 48c-4.3.2-8.1-2.8-8.8-7.1l9.4-10.5c.2-.3.6-.4 1-.5.4 0 .7.1 1 .4l7.8 7c.7.6 1.6.9 2.5.9.9 0 1.7-.5 2.3-1.1l7.8-8.8-1.1 18.6-21.9 1.1zm76.5-29.5-2 34c-.3 4.6-4.3 8.2-8.9 7.9l-34-2c-4.6-.3-8.2-4.3-7.9-8.9l2-34c.3-4.4 3.9-7.9 8.4-7.9h.5l34 2c4.7.3 8.2 4.3 7.9 8.9z" fill="currentColor"/><path d="M78.2 41.6 61.3 30.5c-2.1-1.4-4.9-.8-6.2 1.3-.4.7-.7 1.4-.7 2.2l-1.2 20.1c-.1 2.5 1.7 4.6 4.2 4.8h.3c.7 0 1.4-.2 2-.5l18-9c2.2-1.1 3.1-3.8 2-6-.4-.7-.9-1.3-1.5-1.8zm-1.4 6-18 9c-.4.2-.8.3-1.3.3-.4 0-.9-.2-1.2-.4-.7-.5-1.2-1.3-1.1-2.2l1.2-20.1c.1-.9.6-1.7 1.4-2.1.8-.4 1.7-.3 2.5.1L77 43.3c1.2.8 1.5 2.3.7 3.4-.2.4-.5.7-.9.9z" fill="currentColor"/></svg>`,
  newMsg: () => `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12.202 3.203H5.25a3 3 0 0 0-3 3V18.75a3 3 0 0 0 3 3h12.547a3 3 0 0 0 3-3v-6.952" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><path d="M10.002 17.226H6.774v-3.228L18.607 2.165a1.417 1.417 0 0 1 2.004 0l1.224 1.225a1.417 1.417 0 0 1 0 2.004Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`,
  logoIcon: () => `<svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2.982c2.937 0 3.285.011 4.445.064a6.087 6.087 0 0 1 2.042.379 3.408 3.408 0 0 1 1.265.823 3.408 3.408 0 0 1 .823 1.265 6.087 6.087 0 0 1 .379 2.042c.053 1.16.064 1.508.064 4.445s-.011 3.285-.064 4.445a6.087 6.087 0 0 1-.379 2.042 3.643 3.643 0 0 1-2.088 2.088 6.087 6.087 0 0 1-2.042.379c-1.16.053-1.508.064-4.445.064s-3.285-.011-4.445-.064a6.087 6.087 0 0 1-2.043-.379 3.408 3.408 0 0 1-1.264-.823 3.408 3.408 0 0 1-.823-1.265 6.087 6.087 0 0 1-.379-2.042c-.053-1.16-.064-1.508-.064-4.445s.011-3.285.064-4.445a6.087 6.087 0 0 1 .379-2.042 3.408 3.408 0 0 1 .823-1.265 3.408 3.408 0 0 1 1.265-.823 6.087 6.087 0 0 1 2.042-.379c1.16-.053 1.508-.064 4.445-.064M12 1c-2.987 0-3.362.013-4.535.066a8.074 8.074 0 0 0-2.67.511 5.392 5.392 0 0 0-1.949 1.27 5.392 5.392 0 0 0-1.269 1.948 8.074 8.074 0 0 0-.51 2.67C1.012 8.638 1 9.013 1 12s.013 3.362.066 4.535a8.074 8.074 0 0 0 .511 2.67 5.392 5.392 0 0 0 1.27 1.949 5.392 5.392 0 0 0 1.948 1.269 8.074 8.074 0 0 0 2.67.51C8.638 22.988 9.013 23 12 23s3.362-.013 4.535-.066a8.074 8.074 0 0 0 2.67-.511 5.625 5.625 0 0 0 3.218-3.218 8.074 8.074 0 0 0 .51-2.67C22.988 15.362 23 14.987 23 12s-.013-3.362-.066-4.535a8.074 8.074 0 0 0-.511-2.67 5.392 5.392 0 0 0-1.27-1.949 5.392 5.392 0 0 0-1.948-1.269 8.074 8.074 0 0 0-2.67-.51C15.362 1.012 14.987 1 12 1Zm0 5.351A5.649 5.649 0 1 0 17.649 12 5.649 5.649 0 0 0 12 6.351Zm0 9.316A3.667 3.667 0 1 1 15.667 12 3.667 3.667 0 0 1 12 15.667Zm5.872-10.859a1.32 1.32 0 1 0 1.32 1.32 1.32 1.32 0 0 0-1.32-1.32Z" fill="currentColor"/></svg>`,
};

// ============================================================ AUTH SCREENS
function renderAuth(mode) {
  stopChat();
  document.title = mode === 'signup' ? 'Sign up • InstaClone' : 'Login • InstaClone';
  const shots = ['beach', 'coffee', 'kili', 'food', 'city', 'dog'].map(n => `/seed/${n}.jpg`);
  const isLogin = mode !== 'signup';
  app.innerHTML = `
  <div class="auth-wrap">
    ${isLogin ? `<div class="auth-phone"><div class="screen">${shots.map((s, i) => `<img src="${s}" class="${i === 0 ? 'on' : ''}" alt="">`).join('')}</div></div>` : ''}
    <div class="auth-col">
      <div class="auth-card">
        <span class="logo">InstaClone</span>
        ${isLogin ? '' : '<p class="auth-sub">Sign up to see photos and videos from your friends.</p>'}
        <form id="authForm" autocomplete="on" novalidate>
          ${isLogin ? `
            <div class="field"><input name="login" placeholder=" " autocomplete="username" required><label>Phone number, username, or email</label></div>
            <div class="field"><input name="password" type="password" placeholder=" " autocomplete="current-password" required><label>Password</label><button type="button" class="toggle hidden">Show</button></div>
          ` : `
            <div class="field"><input name="email" type="email" placeholder=" " autocomplete="email" required><label>Email address</label></div>
            <div class="field"><input name="full_name" placeholder=" " autocomplete="name"><label>Full Name</label></div>
            <div class="field"><input name="username" placeholder=" " autocomplete="username" required><label>Username</label></div>
            <div class="field"><input name="password" type="password" placeholder=" " autocomplete="new-password" required><label>Password</label><button type="button" class="toggle hidden">Show</button></div>
            <p class="auth-small">People who use our service may have uploaded your contact information to InstaClone.</p>
          `}
          <button class="btn block" type="submit" disabled>${isLogin ? 'Log in' : 'Sign up'}</button>
        </form>
        <div class="auth-err" id="authErr"></div>
        ${isLogin ? `<div class="divider">OR</div><a class="link-btn" href="javascript:void 0" id="forgot" style="font-size:12px;color:#00376b;font-weight:400">Forgot password?</a>` : ''}
      </div>
      <div class="auth-switch">${isLogin ? `Don't have an account? <a class="link-btn" href="#/signup">Sign up</a>` : `Have an account? <a class="link-btn" href="#/login">Log in</a>`}</div>
      ${isLogin ? `<div class="demo-hint">Try a demo account → username <b>zanzibar_vibes</b> · password <b>password123</b><br>or create your own account with Sign up.</div>` : ''}
    </div>
  </div>`;

  // phone slideshow
  if (isLogin) {
    let i = 0;
    const imgs = $$('.auth-phone img');
    const t = setInterval(() => {
      if (!document.body.contains(imgs[0])) return clearInterval(t);
      imgs[i].classList.remove('on'); i = (i + 1) % imgs.length; imgs[i].classList.add('on');
    }, 3500);
    $('#forgot').onclick = () => toast('Password reset by email is not configured in this demo.');
  }

  const form = $('#authForm'), btn = $('button[type=submit]', form), err = $('#authErr');
  const pw = form.password, tog = $('.toggle', form);
  form.addEventListener('input', () => {
    const ok = isLogin ? form.login.value.trim() && pw.value.length >= 1 : form.email.value.trim() && form.username.value.trim() && pw.value.length >= 1;
    btn.disabled = !ok;
    tog.classList.toggle('hidden', !pw.value);
  });
  tog.onclick = () => { const show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; tog.textContent = show ? 'Hide' : 'Show'; };
  form.onsubmit = async e => {
    e.preventDefault();
    err.textContent = ''; btn.disabled = true; btn.textContent = isLogin ? 'Logging in…' : 'Signing up…';
    try {
      const body = Object.fromEntries(new FormData(form));
      const data = await api('POST', isLogin ? '/api/login' : '/api/register', body);
      S.token = data.token; localStorage.setItem('ic_token', data.token);
      S.me = data.user;
      if (!isLogin) toast(`Welcome to InstaClone, ${data.user.username}! 🎉`);
      location.hash = '#/';
      boot();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false; btn.textContent = isLogin ? 'Log in' : 'Sign up';
    }
  };
}

function logoutLocal() {
  S.me = null; S.token = null; localStorage.removeItem('ic_token');
  closeModal(); stopChat();
  location.hash = '#/login';
  renderAuth('login');
}
async function logout() {
  try { await api('POST', '/api/logout'); } catch { }
  logoutLocal();
}

// ============================================================ SHELL
function navItem(href, key, label, icon, active, extra = '') {
  return `<a href="${href}" class="${active ? 'active' : ''}" data-nav="${key}"><span class="ico">${icon}${extra}</span><span class="lbl">${label}</span></a>`;
}
function renderShell() {
  const r = currentRoute();
  const k = r.name;
  const isMe = k === 'profile' && r.username === S.me.username;
  const nb = S.unread ? `<span class="dot"></span>` : '';
  const mb = S.unreadMsgs ? `<span class="badge">${S.unreadMsgs}</span>` : '';
  app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <a href="#/" class="logo">InstaClone</a>
      <a href="#/" class="logo-icon">${I.logoIcon()}</a>
      <nav class="nav">
        ${navItem('#/', 'home', 'Home', I.home(k === 'home'), k === 'home')}
        ${navItem('#/search', 'search', 'Search', I.search(k === 'search'), k === 'search')}
        ${navItem('#/explore', 'explore', 'Explore', I.explore(k === 'explore'), k === 'explore')}
        ${navItem('#/direct', 'direct', 'Messages', I.send(k === 'direct'), k === 'direct', mb)}
        ${navItem('#/notifications', 'notifications', 'Notifications', I.heart(false), k === 'notifications', nb)}
        <button data-act="create"><span class="ico">${I.create()}</span><span class="lbl">Create</span></button>
        ${navItem('#/u/' + S.me.username, 'profile', 'Profile', avatar(S.me, 24), isMe)}
      </nav>
      <div class="nav"><div style="flex:1"></div>
        <button data-act="more-menu"><span class="ico">${I.menu()}</span><span class="lbl">More</span></button>
      </div>
    </aside>
    <header class="mobile-top">
      <a href="#/" class="logo">InstaClone</a>
      <div class="r">
        <a href="#/notifications">${I.heart(false)}${nb}</a>
        <a href="#/direct">${I.send(false)}${mb}</a>
      </div>
    </header>
    <main class="main" id="view"></main>
    <nav class="mobile-bottom">
      <a href="#/">${I.home(k === 'home')}</a>
      <a href="#/explore">${I.search(k === 'search' || k === 'explore')}</a>
      <button data-act="create">${I.create()}</button>
      <a href="#/direct">${I.send(k === 'direct')}${mb}</a>
      <a href="#/u/${esc(S.me.username)}" class="${isMe ? 'active' : ''}">${avatar(S.me, 26)}</a>
    </nav>
  </div>`;
}
function refreshBadges() {
  if (!S.me || !$('.layout')) return;
  const r = currentRoute();
  // cheap re-render of nav only
  const view = $('#view'); const keep = view; const scroll = window.scrollY;
  const parent = keep.parentNode; parent.removeChild(keep);
  renderShell();
  $('#view').replaceWith(keep);
  window.scrollTo(0, scroll);
  void r;
}

// ============================================================ ROUTER
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'home' };
  switch (parts[0]) {
    case 'login': return { name: 'login' };
    case 'signup': return { name: 'signup' };
    case 'explore': return { name: 'explore' };
    case 'search': return { name: 'search' };
    case 'notifications': return { name: 'notifications' };
    case 'direct': return { name: 'direct', username: parts[1] || null };
    case 'edit': return { name: 'edit' };
    case 'p': return { name: 'post', id: +parts[1] };
    case 'u': return { name: 'profile', username: parts[1], tab: parts[2] || 'posts' };
    default: return { name: 'notfound' };
  }
}

async function route() {
  const r = currentRoute();
  if (!S.me) { renderAuth(r.name === 'signup' ? 'signup' : 'login'); return; }
  if (r.name === 'login' || r.name === 'signup') { location.hash = '#/'; return; }
  closeModal(true);
  stopChat();
  renderShell();
  const id = ++S.routeId;
  const view = $('#view');
  view.innerHTML = '<div class="spinner"></div>';
  window.scrollTo(0, 0);
  try {
    const pages = { home: pageHome, explore: pageExplore, search: pageSearch, notifications: pageNotifications, direct: pageDirect, edit: pageEdit, profile: pageProfile, post: pagePost };
    const fn = pages[r.name];
    if (!fn) { view.innerHTML = notFound(); return; }
    await fn(view, r, () => id === S.routeId);
  } catch (e) {
    if (id === S.routeId) view.innerHTML = notFound(e.message);
  }
}
const notFound = (msg) => `<div class="empty" style="padding-top:80px"><h3 style="font-size:22px">${esc(msg || "Sorry, this page isn't available.")}</h3><p>The link you followed may be broken, or the page may have been removed. <a class="link-btn" href="#/">Go back to InstaClone.</a></p></div>`;

// ============================================================ POST CARD
function postCard(p) {
  const comments = (p.preview_comments || []).map(c => `<div class="mini-c"><b><a href="#/u/${esc(c.username)}">${esc(c.username)}</a></b>${richText(c.text)}</div>`).join('');
  return `
  <article class="post" data-post="${p.id}">
    <div class="post-head">
      <a href="#/u/${esc(p.username)}">${avatar(p, 32)}</a>
      <div class="names">
        <div><a class="uname" href="#/u/${esc(p.username)}">${esc(p.username)}</a> <span class="time">• ${ago(p.created_at)}</span></div>
        ${p.location ? `<div class="loc">${esc(p.location)}</div>` : ''}
      </div>
      <button class="icon-btn" data-act="post-menu" data-id="${p.id}" data-owner="${esc(p.username)}">${I.more()}</button>
    </div>
    <div class="post-media" data-act="media" data-id="${p.id}">
      <img src="${esc(p.image)}" alt="Photo by ${esc(p.username)}" loading="lazy">
      <div class="big-heart">${I.heart(true, 96)}</div>
    </div>
    <div class="actions">
      <button class="icon-btn like-btn ${p.liked ? 'liked' : ''}" data-act="like" data-id="${p.id}">${I.heart(p.liked)}</button>
      <button class="icon-btn" data-act="open-post" data-id="${p.id}">${I.comment()}</button>
      <button class="icon-btn" data-act="share" data-id="${p.id}">${I.send(false)}</button>
      <span class="spacer"></span>
      <button class="icon-btn save-btn" data-act="save" data-id="${p.id}">${I.save(p.saved)}</button>
    </div>
    <div class="likes" data-act="likes" data-id="${p.id}"><span class="lc">${plural(p.like_count, 'like')}</span></div>
    ${p.caption ? `<div class="caption"><a class="u" href="#/u/${esc(p.username)}">${esc(p.username)}</a>${richText(p.caption)}</div>` : ''}
    ${p.comment_count > 2 ? `<a class="view-all" data-act="open-post" data-id="${p.id}">View all ${p.comment_count} comments</a>` : ''}
    <div class="mini-comments">${comments}</div>
    <form class="add-c" data-form="comment" data-id="${p.id}">
      <input placeholder="Add a comment…" maxlength="1000" autocomplete="off">
      <button type="submit" disabled>Post</button>
    </form>
  </article>`;
}
function tile(p) {
  return `<div class="tile" data-act="open-post" data-id="${p.id}">
    <img src="${esc(p.image)}" alt="" loading="lazy">
    <div class="ov"><span>${I.heart(true, 19).replace('#ff3040', '#fff')} ${fmt(p.like_count)}</span><span>${I.comment(19).replace('fill="none"', 'fill="#fff"').replace('stroke="currentColor"', 'stroke="#fff"')} ${fmt(p.comment_count)}</span></div>
  </div>`;
}
function setLikeUI(id, liked, count) {
  $$(`[data-act=like][data-id="${id}"]`).forEach(b => { b.innerHTML = I.heart(liked); b.classList.toggle('liked', liked); });
  if (typeof count === 'number') $$(`[data-post="${id}"] .lc, .pd[data-pid="${id}"] .lc`).forEach(el => el.textContent = plural(count, 'like'));
}
function setSaveUI(id, saved) {
  $$(`[data-act=save][data-id="${id}"]`).forEach(b => b.innerHTML = I.save(saved));
}
function followBtn(username, isFollowing, small = false) {
  if (small) return `<button class="link-btn" data-act="follow" data-user="${esc(username)}" style="${isFollowing ? 'color:#000' : ''}">${isFollowing ? 'Following' : 'Follow'}</button>`;
  return `<button class="btn ${isFollowing ? 'gray' : ''}" data-act="follow" data-user="${esc(username)}">${isFollowing ? 'Following' : 'Follow'}</button>`;
}

// ============================================================ PAGES
async function pageHome(view, r, alive) {
  document.title = 'InstaClone';
  const [feed, stories, sug] = await Promise.all([api('GET', '/api/feed'), api('GET', '/api/stories'), api('GET', '/api/suggestions')]);
  const explore = feed.posts.length ? null : (await api('GET', '/api/explore')).posts.slice(0, 10);
  if (!alive()) return;
  S.stories = stories.stories;
  view.innerHTML = `
  <div class="home">
    <div class="feed">
      ${stories.stories.length ? `<div class="stories">${stories.stories.map((s, i) => `
        <div class="story" data-act="story" data-idx="${i}">
          <span class="ring ${s.seen ? 'seen' : ''}"><span class="inner">${avatar(s.user, 56)}</span></span>
          <span>${s.user.id === S.me.id ? 'Your story' : esc(s.user.username)}</span>
        </div>`).join('')}</div>` : ''}
      ${feed.posts.length ? feed.posts.map(postCard).join('') : `
        <div class="empty"><div class="circle">${I.camera()}</div><h3>Welcome to InstaClone</h3>
        <p>Follow people to start seeing the photos they share, or share your first photo.</p><br>
        <button class="btn" data-act="create">Share your first photo</button></div>
        ${explore && explore.length ? `<h4 style="font-size:16px;margin:10px 4px 16px">Suggested posts</h4>${explore.map(postCard).join('')}` : ''}`}
      ${feed.posts.length ? `<div class="empty" style="padding:30px"><p>✅ You're all caught up</p><p style="font-size:12px;margin-top:6px">You've seen all new posts. <a class="link-btn" href="#/explore">Explore more</a></p></div>` : ''}
    </div>
    <aside class="right">
      <div class="me-row">
        <a href="#/u/${esc(S.me.username)}">${avatar(S.me, 44)}</a>
        <div class="names"><a class="uname" href="#/u/${esc(S.me.username)}">${esc(S.me.username)}</a><div class="sub">${esc(S.me.full_name)}</div></div>
        <button class="link-btn" data-act="logout" style="font-size:12px">Log out</button>
      </div>
      ${sug.users.length ? `<h4><span>Suggested for you</span><a href="#/search" style="color:#000;font-size:12px">See All</a></h4>
      ${sug.users.map(u => `<div class="sug-row">
        <a href="#/u/${esc(u.username)}">${avatar(u, 44)}</a>
        <div class="names"><a class="uname" href="#/u/${esc(u.username)}">${esc(u.username)}</a><div class="sub">${esc(u.full_name || 'Suggested for you')}</div></div>
        ${followBtn(u.username, false, true)}
      </div>`).join('')}` : ''}
      <div class="footer-mini">About · Help · Press · API · Jobs · Privacy · Terms<br><br>© ${new Date().getFullYear()} INSTACLONE</div>
    </aside>
  </div>`;
}

async function pageExplore(view, r, alive) {
  document.title = 'Explore • InstaClone';
  const { posts } = await api('GET', '/api/explore');
  if (!alive()) return;
  view.innerHTML = `<div class="explore">
    <input class="search-box" placeholder="Search" data-act="goto-search" readonly style="cursor:pointer;max-width:420px">
    ${posts.length ? `<div class="grid">${posts.map(tile).join('')}</div>` : `<div class="empty"><p>No posts yet.</p></div>`}
  </div>`;
}

async function pageSearch(view, r, alive) {
  document.title = 'Search • InstaClone';
  view.innerHTML = `<div class="page"><h1>Search</h1>
    <input class="search-box" id="q" placeholder="Search" autocomplete="off" autofocus>
    <div id="results"></div></div>`;
  const q = $('#q'), out = $('#results');
  const showSug = async () => {
    const { users } = await api('GET', '/api/suggestions');
    if (q.value.trim()) return;
    out.innerHTML = `<div class="sec-title">Suggested for you</div>` + (users.length ? users.map(u => userRow(u, followBtn(u.username, false))).join('') : '<p class="empty">You follow everyone already! 🎉</p>');
  };
  let t;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const v = q.value.trim();
      if (!v) return showSug();
      const { users } = await api('GET', '/api/search?q=' + encodeURIComponent(v));
      if (q.value.trim() !== v) return;
      out.innerHTML = users.length ? users.map(u => userRow(u)).join('') : `<p class="empty">No results found for "${esc(v)}".</p>`;
    }, 200);
  };
  q.focus();
  showSug();
}
const userRow = (u, right = '') => `<div class="u-row" data-act="goto-user" data-user="${esc(u.username)}">${avatar(u, 44)}<div class="names"><div class="uname">${esc(u.username)}</div><div class="sub">${esc(u.full_name)}</div></div>${right}</div>`;

async function pageNotifications(view, r, alive) {
  document.title = 'Notifications • InstaClone';
  const { notifications } = await api('GET', '/api/notifications');
  if (!alive()) return;
  S.unread = 0; refreshBadges();
  const v = $('#view');
  const row = n => {
    const msg = n.type === 'like' ? 'liked your photo.' : n.type === 'comment' ? `commented: ${esc(n.text)}` : 'started following you.';
    const right = n.type === 'follow' ? followBtn(n.username, !!n.is_following)
      : n.post_image ? `<img class="thumb" src="${esc(n.post_image)}" data-act="open-post" data-id="${n.post_id}" alt="">` : '';
    return `<div class="n-row ${n.is_read ? '' : 'unread'}">
      <a href="#/u/${esc(n.username)}">${avatar(n, 44)}</a>
      <div class="txt"><a class="uname" href="#/u/${esc(n.username)}">${esc(n.username)}</a> ${msg} <span class="t">${ago(n.created_at)}</span></div>
      ${right}</div>`;
  };
  const week = Date.now() / 1000 - 7 * 86400;
  const recent = notifications.filter(n => n.created_at >= week), older = notifications.filter(n => n.created_at < week);
  v.innerHTML = `<div class="page"><h1>Notifications</h1>
    ${notifications.length ? `
      ${recent.length ? `<div class="sec-title">This week</div>${recent.map(row).join('')}` : ''}
      ${older.length ? `<div class="sec-title">Earlier</div>${older.map(row).join('')}` : ''}`
      : `<div class="empty"><div class="circle">${I.heart(false)}</div><h3 style="font-size:20px">Activity on your posts</h3><p>When someone likes or comments on one of your posts, or follows you, you'll see it here.</p></div>`}
  </div>`;
}

async function pageProfile(view, r, alive) {
  const data = await api('GET', '/api/users/' + encodeURIComponent(r.username));
  if (!alive()) return;
  const { user: u, stats, is_me, is_following, follows_you } = data;
  document.title = `${u.full_name || u.username} (@${u.username}) • InstaClone`;
  let posts = data.posts;
  if (r.tab === 'saved' && is_me) posts = (await api('GET', `/api/users/${encodeURIComponent(u.username)}/saved`)).posts;
  if (!alive()) return;
  const buttons = is_me
    ? `<a class="btn gray" href="#/edit">Edit profile</a><button class="btn gray" data-act="logout">Log out</button>`
    : `${is_following ? `<button class="btn gray" data-act="follow" data-user="${esc(u.username)}">Following</button>` : `<button class="btn" data-act="follow" data-user="${esc(u.username)}">${follows_you ? 'Follow Back' : 'Follow'}</button>`}
       <a class="btn gray" href="#/direct/${esc(u.username)}">Message</a>`;
  view.innerHTML = `
  <div class="profile">
    <header class="p-head">
      <div class="p-avatar">${is_me ? `<label style="cursor:pointer" title="Change profile photo">${avatar(u, 150)}<input type="file" accept="image/*" id="quickAvatar" hidden></label>` : avatar(u, 150)}</div>
      <section class="p-info">
        <div class="p-row1"><h2>${esc(u.username)}</h2>${buttons}</div>
        <div class="p-stats">
          <span><b>${fmt(stats.posts)}</b> post${stats.posts === 1 ? '' : 's'}</span>
          <span class="clk" data-act="list" data-kind="followers" data-user="${esc(u.username)}"><b id="fcount">${fmt(stats.followers)}</b> followers</span>
          <span class="clk" data-act="list" data-kind="following" data-user="${esc(u.username)}"><b>${fmt(stats.following)}</b> following</span>
        </div>
        <div class="p-bio">${u.full_name ? `<div class="fn">${esc(u.full_name)}</div>` : ''}${u.bio ? `<div>${richText(u.bio)}</div>` : ''}${u.website ? `<a class="web" href="${esc(/^https?:/.test(u.website) ? u.website : 'https://' + u.website)}" target="_blank" rel="noopener">${esc(u.website.replace(/^https?:\/\//, ''))}</a>` : ''}</div>
      </section>
    </header>
    <div class="tabs">
      <a href="#/u/${esc(u.username)}" class="${r.tab !== 'saved' ? 'on' : ''}">${I.grid()} POSTS</a>
      ${is_me ? `<a href="#/u/${esc(u.username)}/saved" class="${r.tab === 'saved' ? 'on' : ''}">${I.savedSm()} SAVED</a>` : ''}
    </div>
    ${posts.length ? `<div class="grid">${posts.map(tile).join('')}</div>` :
      r.tab === 'saved' ? `<div class="empty"><div class="circle">${I.save(false)}</div><h3 style="font-size:24px">Save</h3><p>Save photos that you want to see again. Only you can see what you've saved.</p></div>` :
      is_me ? `<div class="empty"><div class="circle">${I.camera()}</div><h3>Share Photos</h3><p>When you share photos, they will appear on your profile.</p><br><button class="link-btn" data-act="create">Share your first photo</button></div>` :
      `<div class="empty"><div class="circle">${I.camera()}</div><h3>No Posts Yet</h3></div>`}
  </div>`;
  const qa = $('#quickAvatar');
  if (qa) qa.onchange = async () => {
    if (!qa.files[0]) return;
    const fd = new FormData(); fd.append('avatar', qa.files[0]);
    try { const { user } = await api('PUT', '/api/me', fd); S.me = { ...S.me, ...user }; toast('Profile photo updated.'); route(); } catch (e) { toast(e.message); }
  };
}

async function pagePost(view, r, alive) {
  // direct link to a post: show feed underneath + open the post
  await pageHome(view, r, alive);
  if (alive() && r.id) openPost(r.id);
}

async function pageEdit(view) {
  document.title = 'Edit profile • InstaClone';
  const { user } = await api('GET', '/api/me');
  S.me = { ...S.me, ...user };
  view.innerHTML = `
  <div class="edit">
    <h1>Edit profile</h1>
    <form id="editForm">
      <div class="edit-card">
        <img id="avPrev" class="avatar" src="${esc(av(user))}" style="width:56px;height:56px">
        <div class="names"><div class="uname">${esc(user.username)}</div><div class="sub">${esc(user.full_name)}</div></div>
        <label class="btn" style="cursor:pointer">Change photo<input type="file" name="avatar" accept="image/*" hidden></label>
      </div>
      <label class="lbl">Username</label><input type="text" name="username" value="${esc(user.username)}" maxlength="30">
      <label class="lbl">Name</label><input type="text" name="full_name" value="${esc(user.full_name)}" maxlength="60">
      <label class="lbl">Website</label><input type="text" name="website" value="${esc(user.website)}" maxlength="100" placeholder="Website">
      <label class="lbl">Bio</label><textarea name="bio" rows="3" maxlength="150" placeholder="Bio">${esc(user.bio)}</textarea>
      <div class="count"><span id="bioCount">${user.bio.length}</span> / 150</div>
      <label class="lbl">Email</label><input type="text" value="${esc(user.email)}" disabled style="background:#fafafa;color:#737373">
      <div class="actions-row"><button class="btn" type="submit">Submit</button></div>
    </form>
    <hr>
    <form id="pwForm">
      <h1 style="margin-top:20px">Change password</h1>
      <label class="lbl">Current password</label><input type="password" name="current" autocomplete="current-password">
      <label class="lbl">New password</label><input type="password" name="next" autocomplete="new-password">
      <div class="actions-row"><button class="btn" type="submit">Change password</button></div>
    </form>
  </div>`;
  const f = $('#editForm');
  f.bio.oninput = () => $('#bioCount').textContent = f.bio.value.length;
  f.avatar.onchange = () => { if (f.avatar.files[0]) $('#avPrev').src = URL.createObjectURL(f.avatar.files[0]); };
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    if (!f.avatar.files[0]) fd.delete('avatar');
    try {
      const { user } = await api('PUT', '/api/me', fd);
      S.me = { ...S.me, ...user };
      toast('Profile saved.');
      location.hash = '#/u/' + user.username;
    } catch (ex) { toast(ex.message); }
  };
  const p = $('#pwForm');
  p.onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', '/api/me/password', { current: p.current.value, next: p.next.value }); p.reset(); toast('Password changed.'); }
    catch (ex) { toast(ex.message); }
  };
}

// ---------------------------------------------------------------- DIRECT MESSAGES
async function pageDirect(view, r, alive) {
  document.title = 'Inbox • Direct';
  const { conversations } = await api('GET', '/api/conversations');
  if (!alive()) return;
  view.innerHTML = `
  <div class="dm ${r.username ? 'chatting' : ''}">
    <div class="dm-list">
      <div class="hd"><span>${esc(S.me.username)}</span><button class="icon-btn" data-act="new-msg" title="New message">${I.newMsg()}</button></div>
      <div class="sub-hd">Messages</div>
      <div class="items">
        ${conversations.length ? conversations.map(c => `
          <a class="dm-item ${c.user.username === r.username ? 'on' : ''} ${c.unread ? 'unread' : ''}" href="#/direct/${esc(c.user.username)}">
            ${avatar(c.user, 56)}
            <div class="names"><div class="uname" style="font-weight:400">${esc(c.user.full_name || c.user.username)}</div>
            <div class="sub">${c.last.sender_id === S.me.id ? 'You: ' : ''}${esc(c.last.text)} · ${ago(c.last.created_at)}</div></div>
            ${c.unread ? '<span style="width:8px;height:8px;border-radius:50%;background:#0095f6"></span>' : ''}
          </a>`).join('') : `<p class="empty" style="padding:30px">No messages yet.<br><button class="link-btn" data-act="new-msg" style="margin-top:10px">Send a message</button></p>`}
      </div>
    </div>
    <div class="dm-chat" id="chat">
      ${r.username ? '<div class="spinner"></div>' : `<div class="dm-empty"><div class="empty" style="padding:0"><div class="circle" style="width:96px;height:96px">${I.send(false, 48)}</div></div><h2>Your messages</h2><p>Send private photos and messages to a friend.</p><button class="btn" data-act="new-msg">Send message</button></div>`}
    </div>
  </div>`;
  if (r.username) openChat(r.username, alive);
}

async function openChat(username, alive) {
  const chat = $('#chat');
  const data = await api('GET', '/api/messages/' + encodeURIComponent(username));
  if (!alive()) return;
  const u = data.user;
  let lastId = 0, lastTs = 0;
  chat.innerHTML = `
    <div class="hd"><a href="#/direct" class="icon-btn mob-back">${I.back()}</a>
      <a href="#/u/${esc(u.username)}">${avatar(u, 44)}</a>
      <div><a class="uname" href="#/u/${esc(u.username)}">${esc(u.full_name || u.username)}</a><div class="sub">${esc(u.username)}</div></div>
    </div>
    <div class="dm-msgs" id="msgs">
      <div class="dm-chat-profile">${avatar(u, 96)}<div class="uname" style="font-size:20px">${esc(u.full_name || u.username)}</div><div class="sub">${esc(u.username)} · InstaClone</div><a class="btn gray" href="#/u/${esc(u.username)}" style="margin-top:10px">View profile</a></div>
    </div>
    <form class="dm-input" id="dmForm"><input placeholder="Message…" autocomplete="off" maxlength="2000"><button type="submit">Send</button></form>`;
  const box = $('#msgs');
  const linkify = t => esc(t).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="text-decoration:underline">$1</a>');
  const add = msgs => {
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    msgs.forEach(m => {
      if (m.id <= lastId) return;
      if (m.created_at - lastTs > 1800) box.insertAdjacentHTML('beforeend', `<div class="msg-time">${new Date(m.created_at * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>`);
      box.insertAdjacentHTML('beforeend', `<div class="bubble ${m.sender_id === S.me.id ? 'me' : ''}" title="${new Date(m.created_at * 1000).toLocaleString()}">${linkify(m.text)}</div>`);
      lastId = m.id; lastTs = m.created_at;
    });
    if (nearBottom || msgs.some(m => m.sender_id === S.me.id)) box.scrollTop = box.scrollHeight;
  };
  add(data.messages);
  box.scrollTop = box.scrollHeight;
  const form = $('#dmForm'), input = $('input', form);
  input.focus();
  form.onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = '';
    try { const { message } = await api('POST', '/api/messages/' + encodeURIComponent(u.username), { text }); add([message]); }
    catch (ex) { toast(ex.message); input.value = text; }
  };
  stopChat();
  S.chatTimer = setInterval(async () => {
    if (!alive() || !document.body.contains(box)) return stopChat();
    try { const d = await api('GET', `/api/messages/${encodeURIComponent(u.username)}?after=${lastId}`); add(d.messages); } catch { }
  }, 2500);
  if (S.unreadMsgs) { pollMe(); }
}
function stopChat() { if (S.chatTimer) { clearInterval(S.chatTimer); S.chatTimer = null; } }

// ============================================================ MODALS
function openModal(inner, cls = '', full = false) {
  closeModal(true);
  const bg = document.createElement('div');
  bg.className = 'modal-bg' + (full ? ' full' : '');
  bg.id = 'modal';
  bg.innerHTML = `<button class="modal-x" data-act="close-modal">${I.close(22)}</button><div class="modal ${cls}">${inner}</div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) closeModal(); });
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  return $('.modal', bg);
}
function closeModal(silent) {
  const m = $('#modal');
  if (m) m.remove();
  document.body.style.overflow = '';
  if (!silent && location.hash.startsWith('#/p/')) history.replaceState(null, '', '#/');
}

async function openPost(id) {
  const m = openModal('<div class="spinner"></div>', 'pd', true);
  m.dataset.pid = id;
  let data;
  try { data = await api('GET', '/api/posts/' + id); } catch (e) { m.innerHTML = `<div class="empty" style="margin:auto">${esc(e.message)}</div>`; return; }
  const { post: p, comments } = data;
  const canDel = c => c.user_id === S.me.id || p.user_id === S.me.id;
  const cmHtml = c => `<div class="cm" data-cid="${c.id}"><a href="#/u/${esc(c.username)}">${avatar(c, 32)}</a><div class="body"><a class="u" href="#/u/${esc(c.username)}">${esc(c.username)}</a>${richText(c.text)}
      <div class="meta"><span>${ago(c.created_at)}</span><button data-act="reply" data-user="${esc(c.username)}">Reply</button>${canDel(c) ? `<button data-act="del-comment" data-id="${c.id}">Delete</button>` : ''}</div></div></div>`;
  m.innerHTML = `
    <div class="pd-img" data-act="media" data-id="${p.id}">
      <img src="${esc(p.image)}" alt="">
      <div class="big-heart">${I.heart(true, 96)}</div>
    </div>
    <div class="pd-side">
      <div class="post-head">
        <a href="#/u/${esc(p.username)}">${avatar(p, 32)}</a>
        <div class="names"><a class="uname" href="#/u/${esc(p.username)}">${esc(p.username)}</a>${p.location ? `<div class="loc">${esc(p.location)}</div>` : ''}</div>
        <button class="icon-btn" data-act="post-menu" data-id="${p.id}" data-owner="${esc(p.username)}">${I.more()}</button>
      </div>
      <div class="pd-comments" id="pdc">
        ${p.caption ? `<div class="cm"><a href="#/u/${esc(p.username)}">${avatar(p, 32)}</a><div class="body"><a class="u" href="#/u/${esc(p.username)}">${esc(p.username)}</a>${richText(p.caption)}<div class="meta"><span>${ago(p.created_at)}</span></div></div></div>` : ''}
        ${comments.map(cmHtml).join('')}
        ${!p.caption && !comments.length ? `<div class="empty" style="padding:80px 0"><h3 style="font-size:22px">No comments yet.</h3><p>Start the conversation.</p></div>` : ''}
      </div>
      <div class="pd-foot">
        <div class="actions">
          <button class="icon-btn like-btn ${p.liked ? 'liked' : ''}" data-act="like" data-id="${p.id}">${I.heart(p.liked)}</button>
          <button class="icon-btn" data-act="focus-comment">${I.comment()}</button>
          <button class="icon-btn" data-act="share" data-id="${p.id}">${I.send(false)}</button>
          <span class="spacer"></span>
          <button class="icon-btn" data-act="save" data-id="${p.id}">${I.save(p.saved)}</button>
        </div>
        <div class="likes" data-act="likes" data-id="${p.id}"><span class="lc">${plural(p.like_count, 'like')}</span></div>
        <div class="time">${ago(p.created_at, true).toUpperCase()}</div>
        <form class="add-c" data-form="comment" data-id="${p.id}" data-modal="1">
          <input placeholder="Add a comment…" maxlength="1000" autocomplete="off">
          <button type="submit" disabled>Post</button>
        </form>
      </div>
    </div>`;
  m._cmHtml = cmHtml;
}

async function openUserList(title, url) {
  const m = openModal(`<div class="m-hd"><span style="width:30px"></span><span class="t">${esc(title)}</span><button data-act="close-modal">${I.close()}</button></div><div class="body"><div class="spinner"></div></div>`, 'list-modal');
  try {
    const { users } = await api('GET', url);
    $('.body', m).innerHTML = users.length ? users.map(u => userRow(u, u.is_me || u.id === S.me.id ? '' : followBtn(u.username, !!u.is_following))).join('') : `<p class="empty">Nobody here yet.</p>`;
  } catch (e) { $('.body', m).innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

async function openShare(postId) {
  const m = openModal(`<div class="m-hd"><span style="width:30px"></span><span class="t">Share</span><button data-act="close-modal">${I.close()}</button></div>
    <div style="padding:8px 16px;border-bottom:1px solid #efefef;display:flex;gap:10px;align-items:center"><b>To:</b><input id="shareQ" placeholder="Search…" style="flex:1;border:none;outline:none;padding:6px 0"></div>
    <div class="body"><div class="spinner"></div></div>
    <div style="padding:12px 16px"><button class="btn block" data-act="copy-link" data-id="${postId}">Copy link</button></div>`, 'list-modal');
  m.style.height = '480px';
  const link = location.origin + location.pathname + '#/p/' + postId;
  const render = users => {
    $('.body', m).innerHTML = users.filter(u => u.id !== S.me.id).map(u => userRow(u, `<button class="btn" data-act="send-share" data-user="${esc(u.username)}" data-link="${esc(link)}">Send</button>`)).join('') || '<p class="empty">No one to share with yet.</p>';
  };
  const { users } = await api('GET', `/api/users/${encodeURIComponent(S.me.username)}/following`);
  render(users);
  let t;
  $('#shareQ').oninput = e => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = e.target.value.trim();
      if (!q) return render(users);
      render((await api('GET', '/api/search?q=' + encodeURIComponent(q))).users);
    }, 200);
  };
}

function openNewMessage() {
  const m = openModal(`<div class="m-hd"><span style="width:30px"></span><span class="t">New message</span><button data-act="close-modal">${I.close()}</button></div>
    <div style="padding:8px 16px;border-bottom:1px solid #efefef;display:flex;gap:10px;align-items:center"><b>To:</b><input id="nmQ" placeholder="Search…" style="flex:1;border:none;outline:none;padding:6px 0" autofocus></div>
    <div class="body"></div>`, 'list-modal');
  const body = $('.body', m);
  const render = users => body.innerHTML = users.filter(u => u.id !== S.me.id).map(u => `<div class="u-row" data-act="dm-user" data-user="${esc(u.username)}">${avatar(u, 44)}<div class="names"><div class="uname">${esc(u.full_name || u.username)}</div><div class="sub">${esc(u.username)}</div></div></div>`).join('') || '<p class="empty">No account found.</p>';
  api('GET', `/api/users/${encodeURIComponent(S.me.username)}/following`).then(d => { if (!$('#nmQ').value) render(d.users); });
  let t;
  $('#nmQ').oninput = e => { clearTimeout(t); t = setTimeout(async () => render((await api('GET', '/api/search?q=' + encodeURIComponent(e.target.value.trim() || 'a'))).users), 200); };
  $('#nmQ').focus();
}

function openPostMenu(id, owner) {
  const mine = owner === S.me.username;
  openModal(`
    ${mine ? `<button class="danger" data-act="delete-post" data-id="${id}">Delete</button>` : `<button class="danger" data-act="follow-menu" data-user="${esc(owner)}">Unfollow / Follow</button>`}
    <button data-act="open-post" data-id="${id}">Go to post</button>
    <button data-act="share" data-id="${id}">Share to…</button>
    <button data-act="copy-link" data-id="${id}">Copy link</button>
    <a href="#/u/${esc(owner)}" style="display:block;text-align:center;padding:14px;border-top:1px solid #dbdbdb">About this account</a>
    <button data-act="close-modal">Cancel</button>`, 'menu-modal');
}

function openMoreMenu() {
  openModal(`
    <button data-act="nav" data-href="#/edit">Settings & edit profile</button>
    <button data-act="nav" data-href="#/u/${esc(S.me.username)}/saved">Saved</button>
    <button data-act="nav" data-href="#/notifications">Your activity</button>
    <button class="danger" data-act="logout">Log out</button>
    <button data-act="close-modal">Cancel</button>`, 'menu-modal');
}

// ---------------------------------------------------------------- CREATE POST
function openCreate() {
  const m = openModal(`<div class="m-hd"><span style="width:60px"></span><span class="t">Create new post</span><span style="width:60px"></span></div>
    <div class="stage">
      <div class="drop" id="drop">${I.media()}<p>Drag photos here</p>
      <label class="btn" style="cursor:pointer">Select from computer<input type="file" id="cfile" accept="image/jpeg,image/png,image/gif,image/webp" hidden></label></div>
    </div>`, 'create');
  const drop = $('#drop', m);
  const choose = file => {
    if (!file || !/^image\//.test(file.type)) return toast('Please select an image file.');
    if (file.size > 10 * 1024 * 1024) return toast('Image is too large (max 10 MB).');
    const url = URL.createObjectURL(file);
    $('.m-hd', m).innerHTML = `<button class="icon-btn" data-act="create">${I.back()}</button><span class="t">Create new post</span><button class="link-btn" id="shareBtn" style="padding:0 6px">Share</button>`;
    $('.stage', m).innerHTML = `
      <div class="preview"><img src="${url}" alt=""></div>
      <div class="form">
        <div class="me-row">${avatar(S.me, 28)}<span class="uname">${esc(S.me.username)}</span></div>
        <textarea id="cap" placeholder="Write a caption…" maxlength="2200"></textarea>
        <div class="count" style="text-align:right;color:#c7c7c7;font-size:12px"><span id="capN">0</span>/2,200</div>
        <input class="loc" id="loc" placeholder="Add location" maxlength="100">
      </div>`;
    $('#cap').oninput = e => $('#capN').textContent = e.target.value.length;
    $('#cap').focus();
    $('#shareBtn').onclick = async () => {
      const btn = $('#shareBtn'); btn.disabled = true; btn.textContent = 'Sharing…';
      const fd = new FormData(); fd.append('image', file); fd.append('caption', $('#cap').value); fd.append('location', $('#loc').value);
      try {
        await api('POST', '/api/posts', fd);
        $('.stage', m).innerHTML = `<div class="drop"><div style="width:96px;height:96px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;color:#fff;font-size:48px">✓</div><p>Your post has been shared.</p></div>`;
        $('.m-hd', m).innerHTML = `<span style="width:30px"></span><span class="t">Post shared</span><span style="width:30px"></span>`;
        setTimeout(() => { closeModal(); const r = currentRoute(); if (r.name === 'home' || (r.name === 'profile' && r.username === S.me.username)) route(); else location.hash = '#/u/' + S.me.username; }, 1300);
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Share'; }
    };
  };
  $('#cfile', m).onchange = e => choose(e.target.files[0]);
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => choose(e.dataTransfer.files[0]));
}

// ---------------------------------------------------------------- STORIES VIEWER
function openStory(idx) {
  const list = S.stories || [];
  let ui = idx, ii = 0, timer, start, DUR = 5000;
  const v = document.createElement('div');
  v.className = 'story-v';
  document.body.appendChild(v);
  document.body.style.overflow = 'hidden';
  const close = () => { cancelAnimationFrame(timer); v.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); };
  document.addEventListener('keydown', key);
  const show = () => {
    const s = list[ui]; if (!s) return close();
    s.seen = true;
    $$(`.story[data-idx="${ui}"] .ring`).forEach(r => r.classList.add('seen'));
    const it = s.items[ii];
    v.innerHTML = `<button class="story-close">${I.close(24)}</button>
      <div class="story-box">
        <div class="story-bars">${s.items.map((_, k) => `<div><i style="width:${k < ii ? 100 : 0}%"></i></div>`).join('')}</div>
        <div class="story-top">${avatar(s.user, 32)}<a class="uname" href="#/u/${esc(s.user.username)}">${esc(s.user.username)}</a><span style="opacity:.8">${ago(it.created_at)}</span></div>
        <img class="story-img" src="${esc(it.image)}" alt="">
        ${it.caption ? `<div class="story-cap">${esc(it.caption)}</div>` : ''}
        <div class="story-nav l"></div><div class="story-nav r"></div>
      </div>`;
    $('.story-close', v).onclick = close;
    $('.story-nav.l', v).onclick = prev;
    $('.story-nav.r', v).onclick = next;
    $('.story-top a', v).onclick = close;
    const bar = $$('.story-bars i', v)[ii];
    start = performance.now();
    cancelAnimationFrame(timer);
    const tick = t => { const p = Math.min(1, (t - start) / DUR); bar.style.width = p * 100 + '%'; if (p >= 1) next(); else timer = requestAnimationFrame(tick); };
    timer = requestAnimationFrame(tick);
  };
  const next = () => { const s = list[ui]; if (ii < s.items.length - 1) ii++; else { ui++; ii = 0; } if (ui >= list.length) return close(); show(); };
  const prev = () => { if (ii > 0) ii--; else if (ui > 0) { ui--; ii = 0; } show(); };
  v.addEventListener('click', e => { if (e.target === v) close(); });
  show();
}

// ============================================================ GLOBAL EVENT DELEGATION
const lastTap = {};
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    // closing modal when navigating via a link inside it
    const a = e.target.closest('a[href^="#/"]');
    if (a && $('#modal')) closeModal(true);
    return;
  }
  const act = el.dataset.act, id = el.dataset.id, user = el.dataset.user;
  switch (act) {
    case 'create': e.preventDefault(); openCreate(); break;
    case 'close-modal': closeModal(); break;
    case 'logout': logout(); break;
    case 'more-menu': openMoreMenu(); break;
    case 'nav': closeModal(true); location.hash = el.dataset.href; break;
    case 'goto-search': location.hash = '#/search'; break;
    case 'goto-user': closeModal(true); location.hash = '#/u/' + user; break;
    case 'dm-user': closeModal(true); location.hash = '#/direct/' + user; break;
    case 'new-msg': openNewMessage(); break;
    case 'open-post': e.preventDefault(); openPost(id); break;
    case 'story': openStory(+el.dataset.idx); break;
    case 'post-menu': openPostMenu(id, el.dataset.owner); break;
    case 'list': openUserList(el.dataset.kind === 'followers' ? 'Followers' : 'Following', `/api/users/${encodeURIComponent(user)}/${el.dataset.kind}`); break;
    case 'likes': openUserList('Likes', `/api/posts/${id}/likes`); break;
    case 'share': openShare(id); break;
    case 'focus-comment': $('#modal .add-c input')?.focus(); break;
    case 'reply': { const i = $('#modal .add-c input'); if (i) { i.value = '@' + user + ' '; i.focus(); i.dispatchEvent(new Event('input', { bubbles: true })); } break; }
    case 'copy-link': {
      const link = location.origin + location.pathname + '#/p/' + id;
      try { await navigator.clipboard.writeText(link); toast('Link copied to clipboard.'); } catch { prompt('Copy this link:', link); }
      break;
    }
    case 'send-share': {
      el.disabled = true;
      try { await api('POST', '/api/messages/' + encodeURIComponent(user), { text: '📷 Shared a post: ' + el.dataset.link }); el.textContent = 'Sent'; el.classList.add('gray'); }
      catch (ex) { toast(ex.message); el.disabled = false; }
      break;
    }
    case 'like': {
      const liked = el.classList.contains('liked');
      setLikeUI(id, !liked);
      try { const d = await api('POST', `/api/posts/${id}/like`, { like: !liked }); setLikeUI(id, d.liked, d.like_count); }
      catch (ex) { toast(ex.message); }
      break;
    }
    case 'media': {
      // double-tap / double-click to like
      const now = Date.now();
      if (lastTap[id] && now - lastTap[id] < 320) {
        lastTap[id] = 0;
        const h = $('.big-heart', el); h.classList.remove('pop'); void h.offsetWidth; h.classList.add('pop');
        try { const d = await api('POST', `/api/posts/${id}/like`, { like: true }); setLikeUI(id, d.liked, d.like_count); } catch { }
      } else lastTap[id] = now;
      break;
    }
    case 'save': {
      try { const d = await api('POST', `/api/posts/${id}/save`); setSaveUI(id, d.saved); toast(d.saved ? 'Saved to your collection.' : 'Removed from saved.', 1500); }
      catch (ex) { toast(ex.message); }
      break;
    }
    case 'follow':
    case 'follow-menu': {
      if (act === 'follow-menu') closeModal(true);
      try {
        const d = await api('POST', `/api/users/${encodeURIComponent(user)}/follow`);
        $$(`[data-act=follow][data-user="${user}"]`).forEach(b => {
          b.textContent = d.is_following ? 'Following' : 'Follow';
          if (b.classList.contains('btn')) b.classList.toggle('gray', d.is_following);
          else b.style.color = d.is_following ? '#000' : '';
        });
        const fc = $('#fcount'); if (fc && currentRoute().username === user) fc.textContent = fmt(d.followers);
        if (act === 'follow-menu') toast(d.is_following ? `You're now following ${user}.` : `Unfollowed ${user}.`);
      } catch (ex) { toast(ex.message); }
      break;
    }
    case 'delete-post': {
      if (!confirm('Delete this post? This cannot be undone.')) return;
      try { await api('DELETE', '/api/posts/' + id); closeModal(true); toast('Post deleted.'); route(); }
      catch (ex) { toast(ex.message); }
      break;
    }
    case 'del-comment': {
      try { await api('DELETE', '/api/comments/' + id); $(`.cm[data-cid="${id}"]`)?.remove(); toast('Comment deleted.', 1500); }
      catch (ex) { toast(ex.message); }
      break;
    }
  }
});

document.addEventListener('input', e => {
  const f = e.target.closest('form[data-form=comment]');
  if (f) $('button', f).disabled = !e.target.value.trim();
});

document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form=comment]');
  if (!f) return;
  e.preventDefault();
  const input = $('input', f), btn = $('button', f), text = input.value.trim();
  if (!text) return;
  btn.disabled = true;
  try {
    const { comment } = await api('POST', `/api/posts/${f.dataset.id}/comments`, { text });
    input.value = '';
    if (f.dataset.modal) {
      const box = $('#pdc'), m = $('#modal .modal');
      box.querySelector('.empty')?.remove();
      box.insertAdjacentHTML('beforeend', m._cmHtml(comment));
      box.scrollTop = box.scrollHeight;
    }
    // update the feed card preview too
    $$(`[data-post="${f.dataset.id}"] .mini-comments`).forEach(mc => mc.insertAdjacentHTML('beforeend', `<div class="mini-c"><b><a href="#/u/${esc(comment.username)}">${esc(comment.username)}</a></b>${richText(comment.text)}</div>`));
  } catch (ex) { toast(ex.message); btn.disabled = false; }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal')) closeModal(); });

// ============================================================ BOOT
async function pollMe() {
  if (!S.me) return;
  try {
    const d = await api('GET', '/api/me');
    const changed = d.unread !== S.unread || d.unreadMsgs !== S.unreadMsgs;
    S.unread = d.unread; S.unreadMsgs = d.unreadMsgs; S.me = { ...S.me, ...d.user };
    if (changed) refreshBadges();
  } catch { }
}
setInterval(pollMe, 10000);

async function boot() {
  if (S.token && !S.me) {
    try { const d = await api('GET', '/api/me'); S.me = d.user; S.unread = d.unread; S.unreadMsgs = d.unreadMsgs; }
    catch { S.token = null; localStorage.removeItem('ic_token'); }
  } else if (S.me) { pollMe(); }
  route();
}
window.addEventListener('hashchange', route);
boot();
})();
