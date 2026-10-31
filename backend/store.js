import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

// Store: real SQLite database (built into Node 22.5+, nothing to install).
export class Store {
  constructor(file = process.env.DB_PATH || 'data/watchparty.db') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(
        id TEXT PRIMARY KEY,
        host_id INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members(
        room_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY(room_id, user_id));
      CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL);
    `);
  }

  // ----- users -----
  createUser(name, email, passwordHash) {
    const r = this.db.prepare('INSERT INTO users(name,email,password_hash,created_at) VALUES(?,?,?,?)').run(name, email, passwordHash, Date.now());
    return { id: Number(r.lastInsertRowid), username: name, email };
  }
  findUserByEmail(email) {
    const u = this.db.prepare('SELECT * FROM users WHERE email=?').get(email);
    return u && { id: u.id, name: u.name, email: u.email, passwordHash: u.password_hash };
  }

  // ----- rooms -----
  createRoom(id, hostId, videoId) {
    this.db.prepare('INSERT INTO rooms(id,host_id,video_id,created_at) VALUES(?,?,?,?)').run(id, hostId, videoId, Date.now());
    this.setRole(id, hostId, 'host');
  }
  getRoom(id) {
    const r = this.db.prepare('SELECT * FROM rooms WHERE id=?').get(id);
    return r && { id: r.id, hostId: r.host_id, videoId: r.video_id };
  }
  setVideo(id, videoId) { this.db.prepare('UPDATE rooms SET video_id=? WHERE id=?').run(videoId, id); }
  getRole(roomId, userId) {
    return this.db.prepare('SELECT role FROM members WHERE room_id=? AND user_id=?').get(roomId, userId)?.role;
  }
  setRole(roomId, userId, role) {
    this.db.prepare('INSERT INTO members(room_id,user_id,role) VALUES(?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET role=excluded.role').run(roomId, userId, role);
  }
  setHost(roomId, newHostId, oldHostId) {
    this.db.prepare('UPDATE rooms SET host_id=? WHERE id=?').run(newHostId, roomId);
    this.setRole(roomId, newHostId, 'host');
    if (oldHostId) this.setRole(roomId, oldHostId, 'moderator');
  }
  removeMember(roomId, userId) { this.db.prepare('DELETE FROM members WHERE room_id=? AND user_id=?').run(roomId, userId); }
  roomsFor(userId) {
    return this.db.prepare(`SELECT r.id, r.video_id AS videoId, m.role FROM members m JOIN rooms r ON r.id=m.room_id
      WHERE m.user_id=? ORDER BY r.created_at DESC LIMIT 20`).all(userId).map((x) => ({ id: x.id, videoId: x.videoId, role: x.role }));
  }

  // ----- chat history -----
  addMessage(roomId, username, text) {
    this.db.prepare('INSERT INTO messages(room_id,username,text,ts) VALUES(?,?,?,?)').run(roomId, username, text, Date.now());
  }
  getMessages(roomId, limit = 50) {
    return this.db.prepare('SELECT username,text,ts FROM messages WHERE room_id=? ORDER BY id DESC LIMIT ?').all(roomId, limit)
      .reverse().map((m) => ({ username: m.username, text: m.text, ts: m.ts }));
  }
}