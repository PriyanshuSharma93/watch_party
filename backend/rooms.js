export const DEFAULT_VIDEO = 'M7lc1UVf-VE';
export const ACTIONS = ['play', 'pause', 'seek', 'change_video'];
export const canControl = (role) => role === 'host' || role === 'moderator';
const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const VIDEO_ID = /^[\w-]{11}$/;

// Room: live (in-memory) state of one watch party. Pure logic, no sockets or storage.
export class Room {
  constructor(id, videoId = DEFAULT_VIDEO) {
    this.id = id;
    this.users = new Map(); // userId -> { id, username, role, socketId }
    this.requests = new Map(); // requestId -> { id, userId, username, type, payload }
    this.seq = 0;
    this.queue = []; // [{ id, videoId, title, by, byId }]
    this.qseq = 0;
    this.state = { playState: 'paused', time: 0, videoId, at: Date.now() };
  }
  participants() { return [...this.users.values()].map(({ id, username, role }) => ({ id, username, role })); }
  pendingList() { return [...this.requests.values()]; }
  hasHost() { return [...this.users.values()].some((u) => u.role === 'host'); }
  addRequest(user, type, payload) {
    const id = ++this.seq;
    this.requests.set(id, { id, userId: user.id, username: user.username, type, payload });
  }
  // ----- video queue (playlist) -----
  addToQueue(user, videoId, title) {
    if (!VIDEO_ID.test(videoId || '') || this.queue.length >= 30) return null;
    const item = { id: ++this.qseq, videoId, title: String(title || `Video ${videoId}`).slice(0, 100), by: user.username, byId: user.id };
    this.queue.push(item);
    return item;
  }
  takeFromQueue(id) {
    const i = this.queue.findIndex((q) => q.id === id);
    return i < 0 ? null : this.queue.splice(i, 1)[0];
  }
  // ----- playback state -----
  snapshot() {
    const s = this.state;
    const t = s.playState === 'playing' ? s.time + (Date.now() - s.at) / 1000 : s.time;
    return { playState: s.playState, currentTime: t, videoId: s.videoId };
  }
  // Applies a playback action. Returns false if the payload is invalid.
  apply(type, p = {}) {
    const cur = this.snapshot().currentTime;
    const at = Date.now();
    if (type === 'play') this.state = { ...this.state, playState: 'playing', time: cur, at };
    else if (type === 'pause') this.state = { ...this.state, playState: 'paused', time: cur, at };
    else if (type === 'seek') {
      const t = Number(p.time);
      if (!(t >= 0)) return false;
      this.state = { ...this.state, time: t, at };
    } else if (type === 'change_video') {
      if (!VIDEO_ID.test(p.videoId || '')) return false;
      this.state = { playState: 'playing', time: 0, videoId: p.videoId, at };
    } else return false;
    return true;
  }
}

// RoomManager: creates rooms and restores them from the store (persistent rooms).
export class RoomManager {
  constructor(store) { this.store = store; this.rooms = new Map(); }
  create(user) {
    let id;
    do id = makeCode(); while (this.store.getRoom(id));
    this.store.createRoom(id, user.id, DEFAULT_VIDEO);
    const room = new Room(id);
    this.rooms.set(id, room);
    return room;
  }
  load(id) {
    let room = this.rooms.get(id);
    if (room) return room;
    const row = this.store.getRoom(id);
    if (!row) return null;
    room = new Room(id, row.videoId);
    this.rooms.set(id, room);
    return room;
  }
}