// End-to-end check of auth, roles, approval flow, queue and persistence.
// Start the backend first (npm start), then run: npm test   (or BASE=https://your-api npm test)
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://localhost:4000';
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
const connect = (token) => new Promise((res) => { const s = io(BASE, { auth: { token } }); s.on('connect', () => res(s)); });
const ack = (s, e, d) => new Promise((r) => s.emit(e, d, r));
const next = (s, e) => new Promise((r) => s.once(e, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const silent = (p) => Promise.race([p.then(() => false), wait(300).then(() => true)]);
const id = Math.random().toString(36).slice(2, 7);

const h = await post('/api/register', { name: 'Host', email: `h${id}@x.com`, password: 'secret1' });
const g = await post('/api/register', { name: 'Guest', email: `g${id}@x.com`, password: 'secret1' });
ok(h.token && g.user?.username === 'Guest', 'register with name + email');
ok((await post('/api/register', { name: 'Dup', email: `H${id}@X.com`, password: 'secret1' })).error, 'duplicate email rejected');
ok((await post('/api/login', { email: `H${id}@X.com`, password: 'secret1' })).token, 'login with email');
ok(!(await post('/api/login', { email: `h${id}@x.com`, password: 'bad' })).token, 'wrong password rejected');
ok((await (await fetch(BASE + '/health')).json()).ok, 'health endpoint');
const bad = io(BASE, { auth: { token: 'nope' } });
ok(await new Promise((r) => bad.on('connect_error', () => r(true))), 'socket without valid token rejected');
bad.close();

const hs = await connect(h.token), gs = await connect(g.token);
const hr = await ack(hs, 'join_room', {});
const gr = await ack(gs, 'join_room', { roomId: hr.roomId });
ok(hr.participants[0].role === 'host' && gr.participants.find((p) => p.id === gr.userId).role === 'participant', 'creator is host, joiner is participant');

ok(await silent((gs.emit('play'), next(hs, 'sync_state'))), 'participant cannot play directly');
let rq = next(hs, 'requests');
gs.emit('request_action', { type: 'change_video', payload: { videoId: 'dQw4w9WgXcQ' } });
const reqs = await rq;
let st = next(gs, 'sync_state');
hs.emit('resolve_request', { requestId: reqs[0].id, approve: true });
ok((await st).videoId === 'dQw4w9WgXcQ', 'approved request syncs the video');

let ra = next(gs, 'role_assigned');
hs.emit('assign_role', { userId: gr.userId, role: 'moderator' });
ok((await ra).role === 'moderator', 'host assigns moderator');
st = next(hs, 'sync_state'); gs.emit('pause');
ok((await st).playState === 'paused', 'moderator can pause');

let q = next(hs, 'queue');
gs.emit('queue_add', { videoId: 'aaaaaaaaaaa', title: 'Song' });
ok((await q).length === 1, 'queue add');
st = next(gs, 'sync_state'); hs.emit('video_ended', { videoId: 'dQw4w9WgXcQ' });
ok((await st).videoId === 'aaaaaaaaaaa', 'video end plays next in queue');

const cm = next(hs, 'chat_message'); gs.emit('chat', 'hello world');
ok((await cm).text === 'hello world', 'chat delivered');
gs.close(); await wait(250);
const gs2 = await connect(g.token); const gr2 = await ack(gs2, 'join_room', { roomId: hr.roomId });
ok(gr2.participants.find((p) => p.id === gr.userId).role === 'moderator' && gr2.chat.some((m) => m.text === 'hello world'), 'role and chat history persisted');
const rm = next(gs2, 'removed'); hs.emit('remove_participant', { userId: gr.userId });
await rm; ok(true, 'host removes participant');
process.exit(process.exitCode || 0);
