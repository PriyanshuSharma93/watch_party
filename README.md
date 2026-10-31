# Watch Party

Watch YouTube together in real time. Users sign up, create or join rooms, and playback stays in sync for everyone. Roles decide who can control the video.

**Live app:** https://keen-gumption-c63085.netlify.app
**Backend API:** https://watch-party-kddd.onrender.com

> The backend runs on a free Render instance. It sleeps after about 15 minutes without traffic, so the first request can take up to a minute. Open the live app once and wait for it to load before testing.

## Features
| Requirement | How it works |
|---|---|
| Real-time sync | Socket.IO. The server owns the video state and broadcasts `sync_state` |
| Rooms | 6-character room code or invite link (`?room=CODE`) |
| YouTube | YouTube IFrame API, custom controls and seek bar |
| Roles | Host, Moderator, Participant, Viewer. Checked on the server for every event |
| Host powers | Assign roles, remove participants, transfer host |
| Approval flow | Participants send `request_action`. Host/Moderator approve or reject |
| Authentication | Sign up (name, email, password), log in (email, password). bcrypt + JWT |
| Persistence | SQLite: users, rooms, roles, chat history |
| Extras | Shared video queue with auto-play next, chat with typing indicator, emoji reactions, themes, keyboard shortcuts |

## Tech stack
- **Frontend:** React + Vite, socket.io-client
- **Backend:** Node.js, Express, Socket.IO, bcryptjs, jsonwebtoken
- **Database:** SQLite (Node built-in `node:sqlite`, needs Node 22.13+)

## Run locally
Backend (terminal 1):
```bash
cd backend
npm install
npm start          # http://localhost:4000
```
Frontend (terminal 2):
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## Environment variables
| Where | Name | Purpose |
|---|---|---|
| backend | `JWT_SECRET` | Secret used to sign login tokens (set a long random value) |
| backend | `PORT` | Provided by the host |
| backend | `DB_PATH` | Optional SQLite file path (default `data/watchparty.db`) |
| backend | `CLIENT_ORIGIN` | Optional. Your frontend URL, to restrict CORS (default: allow all) |
| frontend | `VITE_API_URL` | Backend URL, e.g. `https://your-backend.onrender.com` |

## Tests
With the backend running: `cd backend && npm test`. To test the live API: `BASE=https://your-api.onrender.com npm test`.
The script checks sign up and login, token-protected sockets, roles, the approval flow, the queue, chat and persistence.

## Security and reliability
- Passwords are hashed with bcrypt. Login uses signed JWTs. The socket handshake rejects invalid tokens.
- Every privileged action (playback, roles, remove, queue play) is re-checked on the server, never only in the UI.
- Login and sign up are rate limited per IP (in memory). Request bodies are size limited and basic security headers are set.
- `GET /health` is a cheap endpoint for uptime monitors. The frontend also pings it on load and shows a "waking up" banner when the free host is asleep.
- Async routes return clean JSON errors, and the UI has an error boundary instead of a blank screen.

## Deployment
- **Backend:** Render Web Service, root directory `backend`, build `npm install`, start `npm start`, `NODE_VERSION=24`.
- **Frontend:** Vercel, root directory `frontend`, framework Vite, build `npm run build`, output `dist`, set `VITE_API_URL`.

## Architecture
```
React app --REST (JWT)--> Express: /api/register, /api/login, /api/rooms
React app --Socket.IO (token in handshake)--> auth middleware --> event handlers
                                   RoomManager -> Room (live state) <-> Store (SQLite)
```
1. Login returns a JWT. The socket connects with it and the server rejects invalid tokens before any event.
2. `join_room` without a code creates a room (creator is Host). With a code it joins as the stored role, default Participant. Rooms are restored from SQLite when needed.
3. `play`, `pause`, `seek`, `change_video` are accepted only from Host/Moderator. The server updates the `Room` and broadcasts `sync_state { playState, currentTime, videoId }`. Time is extrapolated on the server so late joiners start at the right second.
4. Participants use `request_action`. Host/Moderator answer with `resolve_request`.
5. Role changes are Host-only, saved to the database and broadcast with the full participant list.
6. If the Host leaves, the next Moderator (or Participant) becomes Host.

## Trade-offs and known limits
- Live room state is in server memory, so a single backend instance. To scale: Socket.IO Redis adapter and shared room state in Redis.
- On a free Render instance the filesystem is ephemeral, so the SQLite file is lost on redeploy or restart. A managed database (for example Postgres) is the fix.
- CORS is open for the demo. In production, restrict it to the frontend origin.
- JWT is kept in browser storage. httpOnly cookies would be safer. The rate limiter is in memory, so it is per instance.