import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Env = { Bindings: { ASSETS: Fetcher; DB?: D1Database; SESSION_SECRET?: string } };
type User = { id: number; username: string };
const app = new Hono<Env>();
app.use('/api/*', cors({ origin: '*', credentials: true }));

const json = (c: any, body: unknown, status = 200) => c.json(body, status);
const cookie = (c: any, key: string) => c.req.header('Cookie')?.match(new RegExp(`${key}=([^;]+)`))?.[1];
function deviceId(c: any) {
  const existing = cookie(c, 'bv_device');
  if (existing) return { id: existing, fresh: false };
  return { id: crypto.randomUUID(), fresh: true };
}
function setDevice(c: any, id: string) { c.header('Set-Cookie', `bv_device=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`); }
async function session(c: any): Promise<User | null> {
  if (!c.env.DB) return null;
  const token = cookie(c, 'bv_session'); if (!token) return null;
  return (await c.env.DB.prepare('SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > datetime(\'now\')').bind(token).first()) as User | null;
}
function setSession(c: any, token: string) { c.header('Set-Cookie', `bv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`); }
async function hashPassword(password: string, salt: string = crypto.randomUUID()) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${salt}:${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
}
async function checkPassword(password: string, stored: string) { const [salt, expected] = stored.split(':'); return (await hashPassword(password, salt)).split(':')[1] === expected; }

app.post('/api/auth/register', async c => {
  const body = await c.req.json<{ username?: string; password?: string }>(); const username = body.username?.trim();
  if (!username || !body.password || username.length < 3 || body.password.length < 8) return json(c, { error: 'Username needs 3+ characters and password needs 8+ characters.' }, 400);
  if (!c.env.DB) return json(c, { user: { id: 1, username } }, 201);
  try { const hash = await hashPassword(body.password); const result = await c.env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').bind(username, hash).run(); return json(c, { user: { id: result.meta.last_row_id, username } }, 201); } catch { return json(c, { error: 'That username is already taken.' }, 409); }
});
app.post('/api/auth/login', async c => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  if (!c.env.DB) return json(c, { user: { id: 1, username: body.username || 'You' } });
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(body.username?.trim()).first<{ id: number; username: string; password_hash: string }>();
  if (!user || !body.password || !(await checkPassword(body.password, user.password_hash))) return json(c, { error: 'Incorrect username or password.' }, 401);
  const token = crypto.randomUUID(); await c.env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").bind(token, user.id).run(); setSession(c, token); return json(c, { user: { id: user.id, username: user.username } });
});
app.post('/api/auth/logout', async c => { const token = cookie(c, 'bv_session'); if (c.env.DB && token) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run(); c.header('Set-Cookie', 'bv_session=; Path=/; Max-Age=0'); return json(c, { ok: true }); });
app.get('/api/auth/me', async c => json(c, { user: await session(c) }));

app.get('/api/arenas', async c => { if (!c.env.DB) return json(c, { arenas: [] }); const { results } = await c.env.DB.prepare('SELECT arenas.*, users.username AS owner_username, (SELECT COUNT(*) FROM games WHERE games.arena_id = arenas.id) AS game_count, (SELECT COALESCE(SUM(votes), 0) FROM games WHERE games.arena_id = arenas.id) AS vote_count FROM arenas JOIN users ON users.id = arenas.owner_id ORDER BY arenas.created_at DESC').all(); return json(c, { arenas: results }); });
app.post('/api/arenas', async c => { const user = await session(c); if (!user) return json(c, { error: 'Log in to create an arena.' }, 401); const body = await c.req.json<{ name?: string; description?: string }>(); const name = body.name?.trim(); if (!name) return json(c, { error: 'Arena name is required.' }, 400); const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`; const result = await c.env.DB!.prepare('INSERT INTO arenas (name, slug, description, owner_id) VALUES (?, ?, ?, ?)').bind(name, slug, body.description?.trim() || 'A community voting arena', user.id).run(); return json(c, { id: result.meta.last_row_id }, 201); });
app.get('/api/arenas/:id/games', async c => { if (!c.env.DB) return json(c, { games: [] }); const { results } = await c.env.DB.prepare('SELECT * FROM games WHERE arena_id = ? ORDER BY votes DESC, created_at DESC').bind(c.req.param('id')).all(); return json(c, { games: results }); });
app.post('/api/arenas/:id/games', async c => { const user = await session(c); if (!user) return json(c, { error: 'Only the arena admin can add games. Log in first.' }, 401); const owner = await c.env.DB!.prepare('SELECT id FROM arenas WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), user.id).first(); if (!owner) return json(c, { error: 'Only this arena admin can add games.' }, 403); const body = await c.req.json<{ title?: string; platform?: string; genre?: string }>(); if (!body.title?.trim() || !['PS1', 'PS3', 'SEGA'].includes(body.platform || '')) return json(c, { error: 'Title and valid platform are required.' }, 400); const result = await c.env.DB!.prepare('INSERT INTO games (arena_id, title, platform, genre, submitted_by) VALUES (?, ?, ?, ?, ?)').bind(c.req.param('id'), body.title.trim(), body.platform, body.genre?.trim() || 'Other', user.username).run(); return json(c, { id: result.meta.last_row_id }, 201); });
app.post('/api/games/:id/vote', async c => {
  const user = await session(c); if (!user) return json(c, { error: 'Log in to vote.' }, 401);
  const device = deviceId(c); if (device.fresh) setDevice(c, device.id);
  if (!c.env.DB) return json(c, { ok: true });
  try {
    await c.env.DB.prepare('INSERT INTO device_votes (game_id, device_id) VALUES (?, ?)').bind(c.req.param('id'), device.id).run();
    await c.env.DB.prepare('INSERT INTO votes (game_id, user_id) VALUES (?, ?)').bind(c.req.param('id'), user.id).run();
    await c.env.DB.prepare('UPDATE games SET votes = votes + 1 WHERE id = ?').bind(c.req.param('id')).run();
    return json(c, { ok: true });
  } catch { return json(c, { error: 'This device has already voted for this game.' }, 409); }
});
app.all('*', c => c.env.ASSETS.fetch(c.req.raw));
export default app;
