// InstaClone — Instagram-style social app
// Backend: Node.js + Express + PostgreSQL (Supabase) + Supabase Storage for photos
// Passwords are hashed with bcrypt. Sessions use random 256-bit tokens.
require('dotenv').config({ quiet: true });
const express = require('express');
const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

types.setTypeParser(20, v => parseInt(v, 10)); // COUNT(*) & BIGINT → JS numbers

const PORT = process.env.PORT || 3000;
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
// Accept "https://xyz.supabase.co", "https://xyz.supabase.co/" or even ".../rest/v1/" — keep only the origin
const SUPABASE_URL = (() => { try { return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL.trim()).origin : ''; } catch { return ''; } })();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const BUCKET = process.env.SUPABASE_BUCKET || 'instaclone-media';
const USE_CLOUD_STORAGE = !!(SUPABASE_URL && SUPABASE_KEY);
const UPLOAD_DIR = path.join(__dirname, 'uploads'); // only used when Supabase Storage isn't configured

if (!DATABASE_URL) {
  console.error('\n❌ DATABASE_URL is not set. Add your Supabase connection string as an environment variable.\n');
  process.exit(1);
}

// ---------------------------------------------------------------- DATABASE
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});
pool.on('error', err => console.error('Postgres pool error:', err.message));

const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;
const NOW = "EXTRACT(EPOCH FROM NOW())::BIGINT";

async function migrate() {
  await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL,
    email         TEXT NOT NULL,
    full_name     TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    website       TEXT NOT NULL DEFAULT '',
    avatar        TEXT,
    created_at    BIGINT NOT NULL DEFAULT ${NOW}
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (LOWER(username));
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (LOWER(email));
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE IF NOT EXISTS posts (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image      TEXT NOT NULL,
    caption    TEXT NOT NULL DEFAULT '',
    location   TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE IF NOT EXISTS likes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (user_id, post_id)
  );
  CREATE TABLE IF NOT EXISTS saves (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (user_id, post_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id         SERIAL PRIMARY KEY,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    created_at BIGINT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   BIGINT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (follower_id, following_id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    post_id    INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    text       TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE IF NOT EXISTS messages (
    id          SERIAL PRIMARY KEY,
    sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  BIGINT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, receiver_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
  // Supabase exposes tables in the "public" schema through its REST API. This app talks to
  // Postgres directly, so lock that API out with row level security (no policies = no access).
  if (USE_CLOUD_STORAGE) {
    for (const t of ['users', 'sessions', 'posts', 'likes', 'saves', 'comments', 'follows', 'notifications', 'messages']) {
      await pool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------- FILE STORAGE
// New Supabase secret keys (sb_secret_...) must ONLY go in the "apikey" header.
// Legacy service_role keys (JWTs starting with "eyJ") go in both apikey and Authorization.
function storageHeaders(extra = {}) {
  const hd = { apikey: SUPABASE_KEY, ...extra };
  if (!SUPABASE_KEY.startsWith('sb_')) hd.Authorization = `Bearer ${SUPABASE_KEY}`;
  return hd;
}

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

async function ensureBucket() {
  if (!USE_CLOUD_STORAGE) { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); return; }
  const headers = storageHeaders({ 'Content-Type': 'application/json' });
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers });
  if (r.ok) return;
  const c = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST', headers,
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 10 * 1024 * 1024, allowed_mime_types: Object.keys(MIME_EXT) }),
  });
  if (!c.ok && c.status !== 409) throw new Error('Could not create Supabase storage bucket: ' + (await c.text()));
  console.log(`Created public storage bucket "${BUCKET}"`);
}

// Saves an image buffer and returns its public URL
async function saveImage(buffer, mimetype, prefix = 'p') {
  const name = `${prefix}_${crypto.randomBytes(12).toString('hex')}${MIME_EXT[mimetype] || '.jpg'}`;
  if (!USE_CLOUD_STORAGE) {
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
    return '/uploads/' + name;
  }
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': mimetype, 'Cache-Control': 'max-age=31536000' }),
    body: buffer,
  });
  if (!r.ok) throw new Error('Photo upload failed: ' + (await r.text()));
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`;
}

async function deleteImage(url) {
  try {
    if (!url) return;
    if (USE_CLOUD_STORAGE && url.startsWith(SUPABASE_URL)) {
      const name = url.split(`/public/${BUCKET}/`)[1];
      if (!name) return;
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: storageHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [name] }),
      });
    } else if (url.startsWith('/uploads/')) {
      fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- SEED DEMO DATA
async function seed() {
  const { c } = await one('SELECT COUNT(*) AS c FROM users');
  if (c > 0) return;
  console.log('Seeding demo data (first run)...');
  const hash = bcrypt.hashSync('password123', 10);
  const now = Math.floor(Date.now() / 1000);
  const users = [
    ['zanzibar_vibes', 'zanzibar@demo.com', 'Amina Hassan', 'Island girl 🌴 | Travel & sunsets | Zanzibar 🇹🇿', 'zanzibar'],
    ['coffee.daily', 'coffee@demo.com', 'Daniel Mushi', 'Barista ☕ Books 📚 Slow mornings', 'coffee'],
    ['wild_tanzania', 'wild@demo.com', 'Joseph Kimaro', 'Safari guide 🦒 Kilimanjaro summit x12 🏔️', 'wild'],
    ['mama_kitchen', 'kitchen@demo.com', 'Neema Said', 'Home cooking 🍛 Swahili recipes every week', 'kitchen'],
    ['city_lights', 'city@demo.com', 'Brian Otieno', 'Night photographer 📸 Urban stories', 'city'],
    ['goldie_the_pup', 'goldie@demo.com', 'Goldie 🐶', 'Just a good boy. Managed by my humans.', 'goldie'],
  ];
  const ids = [];
  for (const u of users) {
    const avatar = await saveImage(fs.readFileSync(path.join(__dirname, 'seed', `av_${u[4]}.jpg`)), 'image/jpeg', 'a');
    const row = await one('INSERT INTO users (username,email,full_name,password_hash,bio,avatar,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [u[0], u[1], u[2], hash, u[3], avatar, now - 86400 * 30]);
    ids.push(row.id);
  }
  const posts = [
    [0, 'beach.jpg', 'Golden hour in Nungwi never disappoints 🌅⛵ #zanzibar #sunset', 'Nungwi, Zanzibar', 3600 * 2],
    [1, 'coffee.jpg', 'Sunday mornings = latte + a good book ☕📖', 'Dar es Salaam', 3600 * 7],
    [2, 'kili.jpg', 'The roof of Africa from the plains of Amboseli 🏔️🦒', 'Kilimanjaro', 3600 * 20],
    [3, 'food.jpg', 'Pilau Sunday! Recipe in the comments 🍛🔥', 'Arusha', 3600 * 30],
    [4, 'city.jpg', 'City never sleeps ✨ shot on my phone', 'Dar es Salaam', 3600 * 50],
    [5, 'dog.jpg', 'Park day was the best day 🐾☀️', '', 3600 * 70],
  ];
  const postIds = [];
  for (const p of posts) {
    const img = await saveImage(fs.readFileSync(path.join(__dirname, 'seed', p[1])), 'image/jpeg', 'p');
    const row = await one('INSERT INTO posts (user_id,image,caption,location,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id', [ids[p[0]], img, p[2], p[3], now - p[4]]);
    postIds.push(row.id);
  }
  for (const a of ids) for (const b of ids) if (a !== b) await q('INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a, b]);
  for (let i = 0; i < postIds.length; i++) for (let j = 0; j < ids.length; j++)
    if ((i + j) % 3 !== 0) await q('INSERT INTO likes (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ids[j], postIds[i]]);
  const cm = [[0, 2, 'Wow this is stunning 😍', 3000], [0, 4, 'Need to go back ASAP 🔥', 2000], [1, 3, 'That latte art 👌', 20000],
    [2, 0, 'Bucket list!! 🙌', 60000], [3, 5, 'Woof! Save me some chicken 🐶', 90000], [5, 1, 'Cutest pup on the app ❤️', 200000]];
  for (const c of cm) await q('INSERT INTO comments (post_id,user_id,text,created_at) VALUES ($1,$2,$3,$4)', [postIds[c[0]], ids[c[1]], c[2], now - c[3]]);
  console.log('Demo data ready.');
}

// ---------------------------------------------------------------- APP SETUP
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
if (!USE_CLOUD_STORAGE) app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/seed', express.static(path.join(__dirname, 'seed'), { maxAge: '7d' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Only JPG, PNG, GIF or WEBP images are allowed'));
  },
});

// wrap async route handlers so errors reach the error middleware
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------- AUTH HELPERS
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, userId]);
  return token;
}
function getToken(req) {
  const hd = req.headers.authorization || '';
  if (hd.startsWith('Bearer ')) return hd.slice(7);
  return req.cookies.session || null;
}
const auth = h(async (req, res, next) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const user = await one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]);
  if (!user) return res.status(401).json({ error: 'Session expired, please log in again' });
  req.user = user;
  req.token = token;
  next();
});
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, full_name: u.full_name, bio: u.bio, website: u.website, avatar: u.avatar };
}
function setCookie(res, token) {
  res.cookie('session', token, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 1000 * 60 * 60 * 24 * 30 });
}
async function notify(userId, actorId, type, postId = null, text = null) {
  if (userId === actorId) return;
  await q('INSERT INTO notifications (user_id, actor_id, type, post_id, text) VALUES ($1,$2,$3,$4,$5)', [userId, actorId, type, postId, text]);
}
const getUserByName = name => one('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [String(name)]);

// ---------------------------------------------------------------- HEALTH (used to keep the free server awake)
app.get('/api/health', h(async (req, res) => {
  await one('SELECT 1');
  res.json({ ok: true, time: new Date().toISOString() });
}));

// ---------------------------------------------------------------- AUTH ROUTES
app.post('/api/register', h(async (req, res) => {
  let { username = '', email = '', full_name = '', password = '' } = req.body || {};
  username = String(username).trim().toLowerCase();
  email = String(email).trim().toLowerCase();
  full_name = String(full_name).trim().slice(0, 60);
  if (!/^[a-z0-9._]{3,30}$/.test(username))
    return res.status(400).json({ error: 'Username must be 3-30 characters: letters, numbers, dots and underscores only.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (await getUserByName(username)) return res.status(409).json({ error: "This username isn't available. Please try another." });
  if (await one('SELECT 1 FROM users WHERE LOWER(email) = $1', [email])) return res.status(409).json({ error: 'Another account is using this email.' });
  const hash = bcrypt.hashSync(String(password), 10);
  const user = await one('INSERT INTO users (username, email, full_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING *', [username, email, full_name, hash]);
  const token = await createSession(user.id);
  setCookie(res, token);
  res.json({ token, user: publicUser(user) });
}));

app.post('/api/login', h(async (req, res) => {
  const { login = '', password = '' } = req.body || {};
  const l = String(login).trim();
  const user = await one('SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [l]);
  if (!user || !bcrypt.compareSync(String(password), user.password_hash))
    return res.status(401).json({ error: 'Sorry, your password was incorrect. Please double-check your password.' });
  const token = await createSession(user.id);
  setCookie(res, token);
  res.json({ token, user: publicUser(user) });
}));

app.post('/api/logout', auth, h(async (req, res) => {
  await q('DELETE FROM sessions WHERE token = $1', [req.token]);
  res.clearCookie('session');
  res.json({ ok: true });
}));

app.get('/api/me', auth, h(async (req, res) => {
  const { c: unread } = await one('SELECT COUNT(*) AS c FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user.id]);
  const { c: unreadMsgs } = await one('SELECT COUNT(*) AS c FROM messages WHERE receiver_id = $1 AND NOT is_read', [req.user.id]);
  res.json({ user: { ...publicUser(req.user), email: req.user.email }, unread, unreadMsgs });
}));

app.put('/api/me', auth, upload.single('avatar'), h(async (req, res) => {
  const b = req.body || {};
  const full_name = String(b.full_name ?? req.user.full_name).slice(0, 60);
  const bio = String(b.bio ?? req.user.bio).slice(0, 150);
  const website = String(b.website ?? req.user.website).slice(0, 100);
  const username = String(b.username ?? req.user.username).trim().toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(username)) return res.status(400).json({ error: 'Invalid username.' });
  const taken = await one('SELECT id FROM users WHERE LOWER(username) = $1 AND id != $2', [username, req.user.id]);
  if (taken) return res.status(409).json({ error: 'That username is taken.' });
  let avatar = req.user.avatar;
  if (req.file) { avatar = await saveImage(req.file.buffer, req.file.mimetype, 'a'); deleteImage(req.user.avatar); }
  if (b.remove_avatar === '1') { deleteImage(req.user.avatar); avatar = null; }
  const user = await one('UPDATE users SET full_name=$1, bio=$2, website=$3, username=$4, avatar=$5 WHERE id=$6 RETURNING *', [full_name, bio, website, username, avatar, req.user.id]);
  res.json({ user: publicUser(user) });
}));

app.post('/api/me/password', auth, h(async (req, res) => {
  const { current = '', next = '' } = req.body || {};
  if (!bcrypt.compareSync(String(current), req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [bcrypt.hashSync(String(next), 10), req.user.id]);
  await q('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [req.user.id, req.token]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- POSTS
// $1 is always the current user's id
const POST_SELECT = `
  SELECT p.*, u.username, u.avatar, u.full_name,
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
    EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS liked,
    EXISTS(SELECT 1 FROM saves WHERE post_id = p.id AND user_id = $1) AS saved
  FROM posts p JOIN users u ON u.id = p.user_id`;

async function withPreviewComments(posts) {
  if (!posts.length) return posts;
  const rows = await q(`SELECT * FROM (
      SELECT c.id, c.post_id, c.text, c.created_at, u.username,
        ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC, c.id DESC) AS rn
      FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ANY($1)) x
    WHERE rn <= 2 ORDER BY created_at ASC, id ASC`, [posts.map(p => p.id)]);
  return posts.map(p => ({ ...p, preview_comments: rows.filter(r => r.post_id === p.id) }));
}

app.get('/api/feed', auth, h(async (req, res) => {
  const posts = await q(`${POST_SELECT}
    WHERE p.user_id = $1 OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
    ORDER BY p.created_at DESC LIMIT 50`, [req.user.id]);
  res.json({ posts: await withPreviewComments(posts) });
}));

app.get('/api/explore', auth, h(async (req, res) => {
  const posts = await q(`${POST_SELECT} ORDER BY like_count DESC, p.created_at DESC LIMIT 60`, [req.user.id]);
  res.json({ posts: await withPreviewComments(posts) });
}));

app.post('/api/posts', auth, upload.single('image'), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Please choose a photo to share.' });
  const caption = String((req.body && req.body.caption) || '').slice(0, 2200);
  const location = String((req.body && req.body.location) || '').slice(0, 100);
  const image = await saveImage(req.file.buffer, req.file.mimetype, 'p');
  const { id } = await one('INSERT INTO posts (user_id, image, caption, location) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.id, image, caption, location]);
  res.json({ post: await one(`${POST_SELECT} WHERE p.id = $2`, [req.user.id, id]) });
}));

app.get('/api/posts/:id', auth, h(async (req, res) => {
  const post = await one(`${POST_SELECT} WHERE p.id = $2`, [req.user.id, +req.params.id || 0]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const comments = await q('SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = $1 ORDER BY c.created_at ASC, c.id ASC', [post.id]);
  res.json({ post, comments });
}));

app.delete('/api/posts/:id', auth, h(async (req, res) => {
  const post = await one('SELECT * FROM posts WHERE id = $1', [+req.params.id || 0]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own posts' });
  await q('DELETE FROM posts WHERE id = $1', [post.id]);
  deleteImage(post.image);
  res.json({ ok: true });
}));

app.post('/api/posts/:id/like', auth, h(async (req, res) => {
  const post = await one('SELECT * FROM posts WHERE id = $1', [+req.params.id || 0]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const exists = await one('SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2', [req.user.id, post.id]);
  const force = req.body && typeof req.body.like === 'boolean' ? req.body.like : null;
  const shouldLike = force === null ? !exists : force;
  if (shouldLike && !exists) {
    await q('INSERT INTO likes (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, post.id]);
    await notify(post.user_id, req.user.id, 'like', post.id);
  } else if (!shouldLike && exists) {
    await q('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [req.user.id, post.id]);
    await q("DELETE FROM notifications WHERE type='like' AND actor_id=$1 AND post_id=$2", [req.user.id, post.id]);
  }
  const { c } = await one('SELECT COUNT(*) AS c FROM likes WHERE post_id = $1', [post.id]);
  res.json({ liked: shouldLike, like_count: c });
}));

app.post('/api/posts/:id/save', auth, h(async (req, res) => {
  const pid = +req.params.id || 0;
  if (!await one('SELECT 1 FROM posts WHERE id = $1', [pid])) return res.status(404).json({ error: 'Post not found' });
  const exists = await one('SELECT 1 FROM saves WHERE user_id = $1 AND post_id = $2', [req.user.id, pid]);
  if (exists) await q('DELETE FROM saves WHERE user_id = $1 AND post_id = $2', [req.user.id, pid]);
  else await q('INSERT INTO saves (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, pid]);
  res.json({ saved: !exists });
}));

app.post('/api/posts/:id/comments', auth, h(async (req, res) => {
  const post = await one('SELECT * FROM posts WHERE id = $1', [+req.params.id || 0]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const text = String((req.body && req.body.text) || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });
  const { id } = await one('INSERT INTO comments (post_id, user_id, text) VALUES ($1,$2,$3) RETURNING id', [post.id, req.user.id, text]);
  await notify(post.user_id, req.user.id, 'comment', post.id, text);
  res.json({ comment: await one('SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1', [id]) });
}));

app.delete('/api/comments/:id', auth, h(async (req, res) => {
  const c = await one('SELECT c.*, p.user_id AS post_owner FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = $1', [+req.params.id || 0]);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (c.user_id !== req.user.id && c.post_owner !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  await q('DELETE FROM comments WHERE id = $1', [c.id]);
  res.json({ ok: true });
}));

app.get('/api/posts/:id/likes', auth, h(async (req, res) => {
  const users = await q(`SELECT u.id, u.username, u.full_name, u.avatar,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id) AS is_following
    FROM likes l JOIN users u ON u.id = l.user_id WHERE l.post_id = $2 ORDER BY l.created_at DESC`, [req.user.id, +req.params.id || 0]);
  res.json({ users });
}));

// ---------------------------------------------------------------- USERS / PROFILES
app.get('/api/users/:username', auth, h(async (req, res) => {
  const u = await getUserByName(req.params.username);
  if (!u) return res.status(404).json({ error: "Sorry, this page isn't available." });
  const stats = await one(`SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = $1) AS posts,
      (SELECT COUNT(*) FROM follows WHERE following_id = $1) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = $1) AS following`, [u.id]);
  const rel = await one(`SELECT
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AS is_following,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) AS follows_you`, [req.user.id, u.id]);
  const posts = await q(`${POST_SELECT} WHERE p.user_id = $2 ORDER BY p.created_at DESC`, [req.user.id, u.id]);
  res.json({ user: publicUser(u), stats, ...rel, is_me: u.id === req.user.id, posts });
}));

app.get('/api/users/:username/saved', auth, h(async (req, res) => {
  const u = await getUserByName(req.params.username);
  if (!u || u.id !== req.user.id) return res.status(403).json({ error: 'Only you can see your saved posts' });
  const posts = await q(`${POST_SELECT} JOIN saves s ON s.post_id = p.id AND s.user_id = $1 ORDER BY s.created_at DESC`, [req.user.id]);
  res.json({ posts });
}));

app.post('/api/users/:username/follow', auth, h(async (req, res) => {
  const u = await getUserByName(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself" });
  const exists = await one('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [req.user.id, u.id]);
  if (exists) {
    await q('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [req.user.id, u.id]);
    await q("DELETE FROM notifications WHERE type='follow' AND actor_id=$1 AND user_id=$2", [req.user.id, u.id]);
  } else {
    await q('INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, u.id]);
    await notify(u.id, req.user.id, 'follow');
  }
  const { c } = await one('SELECT COUNT(*) AS c FROM follows WHERE following_id = $1', [u.id]);
  res.json({ is_following: !exists, followers: c });
}));

app.get(['/api/users/:username/followers', '/api/users/:username/following'], auth, h(async (req, res) => {
  const list = req.path.endsWith('/followers') ? 'followers' : 'following';
  const u = await getUserByName(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const sql = list === 'followers'
    ? 'SELECT u.*, f.created_at AS fat FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = $1'
    : 'SELECT u.*, f.created_at AS fat FROM follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = $1';
  const rows = await q(`SELECT x.*, EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = x.id) AS is_following
    FROM (${sql}) x ORDER BY x.fat DESC`, [u.id, req.user.id]);
  res.json({ users: rows.map(x => ({ ...publicUser(x), is_following: x.is_following, is_me: x.id === req.user.id })) });
}));

app.get('/api/search', auth, h(async (req, res) => {
  const s = String(req.query.q || '').trim().replace(/[%_\\]/g, '');
  if (!s) return res.json({ users: [] });
  const users = await q(`SELECT * FROM users WHERE username ILIKE $1 OR full_name ILIKE $1
    ORDER BY (username ILIKE $2) DESC, username LIMIT 25`, [`%${s}%`, `${s}%`]);
  res.json({ users: users.map(publicUser) });
}));

app.get('/api/suggestions', auth, h(async (req, res) => {
  const users = await q(`SELECT u.*, (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS fc
    FROM users u WHERE u.id != $1 AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = $1)
    ORDER BY fc DESC, u.created_at DESC LIMIT 6`, [req.user.id]);
  res.json({ users: users.map(publicUser) });
}));

// "Stories" bar: you + people you follow who posted in the last 7 days
app.get('/api/stories', auth, h(async (req, res) => {
  const since = Math.floor(Date.now() / 1000) - 86400 * 7;
  const users = await q(`SELECT u.*, MAX(p.created_at) AS last_post FROM users u JOIN posts p ON p.user_id = u.id
    WHERE (u.id IN (SELECT following_id FROM follows WHERE follower_id = $1) OR u.id = $1) AND p.created_at > $2
    GROUP BY u.id ORDER BY (u.id = $1) DESC, last_post DESC LIMIT 20`, [req.user.id, since]);
  if (!users.length) return res.json({ stories: [] });
  const items = await q('SELECT id, user_id, image, caption, created_at FROM posts WHERE user_id = ANY($1) AND created_at > $2 ORDER BY created_at ASC',
    [users.map(u => u.id), since]);
  res.json({ stories: users.map(u => ({ user: publicUser(u), items: items.filter(i => i.user_id === u.id) })) });
}));

// ---------------------------------------------------------------- NOTIFICATIONS
app.get('/api/notifications', auth, h(async (req, res) => {
  const items = await q(`SELECT n.*, u.username, u.avatar, p.image AS post_image,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = n.actor_id) AS is_following
    FROM notifications n JOIN users u ON u.id = n.actor_id LEFT JOIN posts p ON p.id = n.post_id
    WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 60`, [req.user.id]);
  await q('UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND NOT is_read', [req.user.id]);
  res.json({ notifications: items });
}));

// ---------------------------------------------------------------- DIRECT MESSAGES
app.get('/api/conversations', auth, h(async (req, res) => {
  const me = req.user.id;
  const rows = await q(`
    WITH last AS (
      SELECT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_id, MAX(id) AS last_id
      FROM messages WHERE sender_id = $1 OR receiver_id = $1 GROUP BY 1)
    SELECT l.other_id, m.id AS m_id, m.sender_id, m.receiver_id, m.text, m.created_at AS m_created, m.is_read,
      u.*, (SELECT COUNT(*) FROM messages WHERE sender_id = l.other_id AND receiver_id = $1 AND NOT is_read) AS unread
    FROM last l JOIN messages m ON m.id = l.last_id JOIN users u ON u.id = l.other_id
    ORDER BY l.last_id DESC`, [me]);
  res.json({
    conversations: rows.map(r => ({
      user: publicUser(r),
      last: { id: r.m_id, sender_id: r.sender_id, receiver_id: r.receiver_id, text: r.text, created_at: r.m_created },
      unread: r.unread,
    })),
  });
}));

app.get('/api/messages/:username', auth, h(async (req, res) => {
  const u = await getUserByName(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const after = +req.query.after || 0;
  const msgs = await q(`SELECT * FROM messages WHERE id > $1 AND ((sender_id = $2 AND receiver_id = $3) OR (sender_id = $3 AND receiver_id = $2))
    ORDER BY id ASC LIMIT 500`, [after, req.user.id, u.id]);
  await q('UPDATE messages SET is_read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND NOT is_read', [u.id, req.user.id]);
  res.json({ user: publicUser(u), messages: msgs });
}));

app.post('/api/messages/:username', auth, h(async (req, res) => {
  const u = await getUserByName(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: "You can't message yourself" });
  const text = String((req.body && req.body.text) || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });
  const message = await one('INSERT INTO messages (sender_id, receiver_id, text) VALUES ($1,$2,$3) RETURNING *', [req.user.id, u.id, text]);
  res.json({ message });
}));

// ---------------------------------------------------------------- ERRORS & SPA FALLBACK
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  const status = err.code === 'LIMIT_FILE_SIZE' ? 400 : (err.status || (err.message && /allowed|upload/i.test(err.message) ? 400 : 500));
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 10 MB).' : status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
  });
});

// ---------------------------------------------------------------- START
(async () => {
  try {
    await migrate();
    await ensureBucket();
    await seed();
    app.listen(PORT, '0.0.0.0', () => console.log(`✅ InstaClone running on port ${PORT} (storage: ${USE_CLOUD_STORAGE ? 'Supabase' : 'local disk'})`));
  } catch (e) {
    console.error('\n❌ Startup failed:', e.message);
    if (/ENETUNREACH|ENOTFOUND/.test(e.message)) console.error('Tip: use the Supabase "Session pooler" connection string (host ends with pooler.supabase.com).');
    if (/password authentication/i.test(e.message)) console.error('Tip: the database password in DATABASE_URL is wrong. Reset it in Supabase → Project Settings → Database.');
    process.exit(1);
  }
})();
