import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { checkPassword, hashPassword, requireAuth, signToken, verifyToken } from './auth.js';
import { ACTIONS, RoomManager, canControl } from './rooms.js';
import { Store } from './store.js';

const ASSIGNABLE = ['moderator', 'participant', 'viewer'];
const REACTIONS = ['👍', '😂', '😮', '❤️', '🔥', '👏'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORIGIN = process.env.CLIENT_ORIGIN || '*'; // optional: set to your frontend URL to lock CORS down

const store = new Store();
const mgr = new RoomManager(store);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });
app.disable('x-powered-by');
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: '10kb' }));
app.use((_req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); next(); });

// Tiny in-memory rate limiter (per client IP, fixed window). Enough for a single instance.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    if (n > max) return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    next();
  };
}
app.use('/api/login', rateLimit({ windowMs: 60_000, max: 20 }));
app.use('/api/register', rateLimit({ windowMs: 60_000, max: 20 }));

// Wraps async routes so a thrown error becomes a clean 500 instead of a hanging request.
const safe = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

// ---------- REST: authentication + room list ----------
app.get('/', (_req, res) => res.send('Watch Party backend is running'));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

app.post('/api/register', safe(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 30) return res.status(400).json({ error: 'Name must be 2-30 characters.' });
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (store.findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = store.createUser(name, email, await hashPassword(password));
  res.json({ token: signToken(user), user });
}));

app.post('/api/login', safe(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const row = store.findUserByEmail(email);
  if (!row || !(await checkPassword(password, row.passwordHash))) return res.status(401).json({ error: 'Wrong email or password.' });
  const user = { id: row.id, username: row.name, email: row.email };
  res.json({ token: signToken(user), user });
}));

app.get('/api/me', requireAuth, (req, res) => res.json({ user: { id: req.user.id, username: req.user.username } }));
app.get('/api/rooms', requireAuth, (req, res) => res.json({ rooms: store.roomsFor(req.user.id) }));

// ---------- WebSocket: realtime ----------
io.use((socket, next) => {
  try {
    const p = verifyToken(socket.handshake.auth?.token);
    socket.data.user = { id: p.id, username: p.username };
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

function removeUser(room, userId, event, forget = false) {
  const user = room.users.get(userId);
  if (!user) return;
  room.users.delete(userId);
  for (const [rid, r] of room.requests) if (r.userId === userId) room.requests.delete(rid);
  const sock = io.sockets.sockets.get(user.socketId);
  if (sock) { sock.leave(room.id); sock.data.roomId = null; }
  if (forget) store.removeMember(room.id, userId);
  if (room.users.size === 0) { mgr.rooms.delete(room.id); return; } // stays saved, restored on next join
  io.to(room.id).emit(event, { userId, username: user.username, participants: room.participants() });
  if (user.role === 'host') {
    // Host left: promote first moderator, else first participant.
    const next = room.participants().find((u) => u.role === 'moderator') || room.participants()[0];
    room.users.get(next.id).role = 'host';
    store.setHost(room.id, next.id, forget ? null : userId);
    io.to(room.id).emit('role_assigned', { userId: next.id, username: next.username, role: 'host', participants: room.participants() });
  }
  io.to(room.id).emit('requests', room.pendingList());
}

io.on('connection', (socket) => {
  const me = socket.data.user;
  const ctx = () => {
    const room = mgr.rooms.get(socket.data.roomId);
    const user = room?.users.get(me.id);
    return room && user && user.socketId === socket.id ? { room, user } : {};
  };
  const perform = (room, type, payload) => {
    if (!room.apply(type, payload)) return false;
    if (type === 'change_video') store.setVideo(room.id, room.state.videoId);
    io.to(room.id).emit('sync_state', room.snapshot());
    return true;
  };

  socket.on('join_room', ({ roomId } = {}, ack = () => {}) => {
    const code = String(roomId || '').trim().toUpperCase();
    let room, role;
    if (code) {
      room = mgr.load(code);
      if (!room) return ack({ ok: false, error: 'No room with that code.' });
      role = store.getRole(code, me.id) || 'participant';
      if (store.getRoom(code).hostId === me.id && !room.hasHost()) role = 'host';
    } else {
      room = mgr.create(me);
      role = 'host';
    }
    const prev = room.users.get(me.id);
    if (prev) { // same account in another tab: newest tab wins
      io.to(prev.socketId).emit('replaced');
      io.sockets.sockets.get(prev.socketId)?.leave(room.id);
      role = prev.role;
    }
    store.setRole(room.id, me.id, role);
    room.users.set(me.id, { id: me.id, username: me.username, role, socketId: socket.id });
    socket.data.roomId = room.id;
    socket.join(room.id);
    if (!prev) socket.to(room.id).emit('user_joined', { username: me.username, userId: me.id, role, participants: room.participants() });
    ack({
      ok: true, roomId: room.id, userId: me.id, participants: room.participants(), state: room.snapshot(),
      requests: room.pendingList(), queue: room.queue, chat: store.getMessages(room.id),
    });
  });

  const leave = () => { const { room } = ctx(); if (room) removeUser(room, me.id, 'user_left'); };
  socket.on('leave_room', leave);
  socket.on('disconnect', leave);

  // Playback: Host/Moderator only. Checked here on the server, not just in the UI.
  for (const type of ACTIONS) {
    socket.on(type, (payload) => {
      const { room, user } = ctx();
      if (!room) return;
      if (!canControl(user.role)) return socket.emit('error_msg', 'You do not have permission to do that.');
      perform(room, type, payload);
    });
  }

  // Participants ask, Host/Moderator approve or reject.
  socket.on('request_action', ({ type, payload } = {}) => {
    const { room, user } = ctx();
    if (!room || canControl(user.role) || !ACTIONS.includes(type)) return;
    room.addRequest(user, type, payload);
    io.to(room.id).emit('requests', room.pendingList());
  });

  socket.on('resolve_request', ({ requestId, approve } = {}) => {
    const { room, user } = ctx();
    if (!room || !canControl(user.role)) return;
    const req = room.requests.get(requestId);
    if (!req) return;
    room.requests.delete(requestId);
    if (approve) perform(room, req.type, req.payload);
    io.to(room.id).emit('requests', room.pendingList());
  });

  // Queue: anyone can suggest a video; only Host/Moderator can play or remove (owners can remove their own).
  socket.on('queue_add', ({ videoId, title } = {}) => {
    const { room, user } = ctx();
    if (room && room.addToQueue(user, videoId, title)) io.to(room.id).emit('queue', room.queue);
  });
  socket.on('queue_remove', ({ id } = {}) => {
    const { room, user } = ctx();
    const item = room?.queue.find((q) => q.id === id);
    if (item && (canControl(user.role) || item.byId === user.id)) {
      room.takeFromQueue(id);
      io.to(room.id).emit('queue', room.queue);
    }
  });
  socket.on('queue_play', ({ id } = {}) => {
    const { room, user } = ctx();
    if (!room || !canControl(user.role)) return;
    const item = room.takeFromQueue(id);
    if (!item) return;
    perform(room, 'change_video', { videoId: item.videoId });
    io.to(room.id).emit('queue', room.queue);
  });
  // A privileged client reports the video ended; advance only if it is still the current video.
  socket.on('video_ended', ({ videoId } = {}) => {
    const { room, user } = ctx();
    if (!room || !canControl(user.role) || room.state.videoId !== videoId || room.queue.length === 0) return;
    const next = room.queue.shift();
    perform(room, 'change_video', { videoId: next.videoId });
    io.to(room.id).emit('queue', room.queue);
  });

  // Host-only actions.
  socket.on('assign_role', ({ userId, role } = {}) => {
    const { room, user } = ctx();
    const target = room?.users.get(userId);
    if (!room || user.role !== 'host' || !target || userId === me.id || !ASSIGNABLE.includes(role)) return;
    target.role = role;
    store.setRole(room.id, userId, role);
    io.to(room.id).emit('role_assigned', { userId, username: target.username, role, participants: room.participants() });
  });

  socket.on('remove_participant', ({ userId } = {}) => {
    const { room, user } = ctx();
    const target = room?.users.get(userId);
    if (!room || user.role !== 'host' || !target || userId === me.id) return;
    io.to(target.socketId).emit('removed');
    removeUser(room, userId, 'participant_removed', true);
  });

  socket.on('transfer_host', ({ userId } = {}) => {
    const { room, user } = ctx();
    const target = room?.users.get(userId);
    if (!room || user.role !== 'host' || !target || userId === me.id) return;
    user.role = 'moderator';
    target.role = 'host';
    store.setHost(room.id, userId, me.id);
    io.to(room.id).emit('role_assigned', { userId, username: target.username, role: 'host', participants: room.participants() });
  });

  // Chat, typing, reactions, manual resync.
  socket.on('chat', (text) => {
    const { room, user } = ctx();
    text = String(text || '').trim().slice(0, 300);
    if (!room || !text) return;
    store.addMessage(room.id, user.username, text);
    io.to(room.id).emit('chat_message', { username: user.username, text, ts: Date.now() });
  });
  socket.on('typing', () => { const { room, user } = ctx(); if (room) socket.to(room.id).emit('typing', { username: user.username }); });
  socket.on('reaction', (emoji) => {
    const { room, user } = ctx();
    if (room && REACTIONS.includes(emoji)) io.to(room.id).emit('reaction', { username: user.username, emoji });
  });
  socket.on('resync', () => { const { room } = ctx(); if (room) socket.emit('sync_state', room.snapshot()); });
});

// Keep the server alive on unexpected errors (they are logged for debugging).
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));