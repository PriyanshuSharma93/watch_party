import { useEffect, useRef, useState } from 'react';

const EMOJIS = ['👍', '😂', '😮', '❤️', '🔥', '👏'];
const parseVideoId = (u) => {
  const m = u.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(u.trim()) ? u.trim() : null;
};
const describe = (r) => ({ play: 'play', pause: 'pause', seek: `seek to ${Math.round(r.payload?.time ?? 0)}s`, change_video: 'change the video' }[r.type]);
const hue = (s = '') => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const Avatar = ({ name = '?' }) => (
  <span className="avatar" style={{ background: `hsl(${hue(name)} 70% 60%)` }}>{name[0]?.toUpperCase()}</span>
);
const fmtTime = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Tiny WebAudio beep (no sound files needed).
let audioCtx;
function beep(freq = 660, ms = 120) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; g.gain.value = 0.04;
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* sound is optional */ }
}
function Confetti({ burst }) {
  const [on, setOn] = useState(false);
  useEffect(() => { if (!burst) return; setOn(true); const t = setTimeout(() => setOn(false), 3300); return () => clearTimeout(t); }, [burst]);
  if (!on) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 48 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: `hsl(${(i * 47) % 360} 90% 60%)`, animationDelay: `${(i % 11) * 0.08}s`, '--dx': `${((i * 53) % 120) - 60}px` }} />
      ))}
    </div>
  );
}

// Looks up a YouTube video title (no API key). Returns null if it fails.
const titleCache = {};
async function fetchTitle(id) {
  if (titleCache[id]) return titleCache[id];
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    const d = await r.json();
    if (d.title) return (titleCache[id] = d.title);
  } catch { /* offline or blocked: fall back to no title */ }
  return null;
}

export default function Room({ socket, code, onExit, onAuthFail }) {
  const [roomId, setRoomId] = useState(null);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [chat, setChat] = useState([]);
  const [queue, setQueue] = useState([]);
  const [floats, setFloats] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [typers, setTypers] = useState({});
  const [vurl, setVurl] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [online, setOnline] = useState(false);
  const [copied, setCopied] = useState(false);
  const [videoId, setVideoId] = useState(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState({ t: 0, d: 0 });
  const [drag, setDrag] = useState(null);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [burst, setBurst] = useState(0);
  const [sound, setSound] = useState(() => localStorage.getItem('wp-sound') !== 'off');
  const player = useRef(null), ready = useRef(false), last = useRef(null), roomRef = useRef(code), logRef = useRef(null);
  const privRef = useRef(false), reqsRef = useRef([]), typingAt = useRef(0);
  const soundRef = useRef(true), playingRef = useRef(false), inputRef = useRef(null), welcomed = useRef(false), meRef = useRef(null), nameRef = useRef('');

  const mine = users.find((u) => u.id === me);
  const myRole = mine?.role;
  const priv = myRole === 'host' || myRole === 'moderator';
  privRef.current = priv;
  soundRef.current = sound; meRef.current = me; nameRef.current = mine?.username;

  const toast = (text) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };
  const system = (text) => setChat((c) => [...c.slice(-99), { system: true, text }]);

  function applyState(s) {
    last.current = s;
    setVideoId(s.videoId);
    setPlaying(s.playState === 'playing'); playingRef.current = s.playState === 'playing';
    const p = player.current;
    if (!ready.current || !p) return;
    if (p.getVideoData().video_id !== s.videoId) p.loadVideoById(s.videoId, s.currentTime);
    else if (Math.abs(p.getCurrentTime() - s.currentTime) > 1.5) p.seekTo(s.currentTime, true);
    s.playState === 'playing' ? p.playVideo() : p.pauseVideo();
  }

  // Joins the room (also called again after every reconnect).
  function join() {
    socket.emit('join_room', { roomId: roomRef.current }, (res) => {
      if (!res.ok) return onExit(res.error);
      roomRef.current = res.roomId;
      setMe(res.userId); setUsers(res.participants); setReqs(res.requests); setQueue(res.queue);
      setChat(res.chat); reqsRef.current = res.requests;
      if (!welcomed.current) { welcomed.current = true; setBurst((b) => b + 1); }
      last.current = res.state; setRoomId(res.roomId);
      applyState(res.state);
      history.replaceState(null, '', `?room=${res.roomId}`);
    });
  }

  useEffect(() => {
    const onPeople = (p) => setUsers(p.participants);
    socket.on('connect', () => { setOnline(true); setErr(''); join(); });
    socket.on('disconnect', () => setOnline(false));
    socket.on('connect_error', (e) => (e.message === 'unauthorized' ? onAuthFail() : setOnline(false)));
    socket.on('sync_state', applyState);
    socket.on('user_joined', (p) => { onPeople(p); system(`${p.username} joined`); toast(`👋 ${p.username} joined`); if (soundRef.current) beep(880); });
    socket.on('user_left', (p) => { onPeople(p); system(`${p.username} left`); toast(`${p.username} left`); });
    socket.on('participant_removed', (p) => { onPeople(p); system(`${p.username} was removed`); });
    socket.on('role_assigned', (p) => {
      onPeople(p); system(`${p.username} is now ${p.role}`); toast(`⭐ ${p.username} is now ${p.role}`);
      if (p.userId === meRef.current && (p.role === 'host' || p.role === 'moderator')) setBurst((b) => b + 1);
    });
    socket.on('requests', (list) => {
      if (privRef.current && list.length > reqsRef.current.length) {
        toast(`🔔 ${list[list.length - 1].username} sent a request`);
        if (soundRef.current) beep(740);
      }
      reqsRef.current = list; setReqs(list);
    });
    socket.on('queue', setQueue);
    socket.on('chat_message', (m) => {
      if (soundRef.current && m.username !== nameRef.current) beep(520, 80);
      setChat((c) => [...c.slice(-99), m]);
      setTypers((t) => { const n = { ...t }; delete n[m.username]; return n; });
    });
    socket.on('typing', ({ username }) => {
      setTypers((t) => ({ ...t, [username]: Date.now() }));
      setTimeout(() => setTypers((t) => {
        if (!t[username] || Date.now() - t[username] < 2400) return t;
        const n = { ...t }; delete n[username]; return n;
      }), 2500);
    });
    socket.on('reaction', (r) => {
      const f = { id: Math.random(), emoji: r.emoji, name: r.username, left: 10 + Math.random() * 80 };
      setFloats((x) => [...x, f]);
      setTimeout(() => setFloats((x) => x.filter((y) => y.id !== f.id)), 2500);
    });
    socket.on('error_msg', setErr);
    socket.on('removed', () => onExit('The host removed you from that room.'));
    socket.on('replaced', () => onExit('You opened this room in another tab.'));

    if (socket.connected) { setOnline(true); join(); } else socket.connect();
    return () => { socket.emit('leave_room'); socket.removeAllListeners(); socket.disconnect(); };
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [chat]);
  useEffect(() => { if (videoId) { setTitle(''); fetchTitle(videoId).then((t) => t && setTitle(t)); } }, [videoId]);
  useEffect(() => { if (roomId) document.title = `Room ${roomId} · Watch Party`; return () => { document.title = 'Watch Party'; }; }, [roomId]);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || !ready.current) return;
      if (e.code === 'Space') { if (e.target.tagName === 'BUTTON') return; e.preventDefault(); act(playingRef.current ? 'pause' : 'play'); }
      else if (e.key === 'ArrowRight') skip(10);
      else if (e.key === 'ArrowLeft') skip(-10);
      else if (e.key === 'm') toggleMute();
      else if (e.key === 'f') document.querySelector('.video')?.requestFullscreen?.();
      else if (e.key === '/') { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Create the YouTube player once we are inside a room.
  useEffect(() => {
    if (!roomId) return;
    const init = () => {
      player.current = new window.YT.Player('yt', {
        videoId: last.current.videoId,
        playerVars: { controls: 0, disablekb: 1, rel: 0 },
        events: {
          onReady: () => { ready.current = true; applyState(last.current); },
          // When a video ends, a Host/Moderator tells the server to play the next queued video.
          onStateChange: (e) => { if (e.data === 0 && privRef.current) socket.emit('video_ended', { videoId: last.current.videoId }); },
        },
      });
    };
    if (window.YT?.Player) init();
    else {
      window.onYouTubeIframeAPIReady = init;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(s);
    }
    const tick = setInterval(() => {
      const p = player.current;
      if (ready.current && p?.getDuration) setProgress({ t: p.getCurrentTime(), d: p.getDuration() || 0 });
    }, 500);
    return () => { clearInterval(tick); ready.current = false; player.current?.destroy?.(); player.current = null; };
  }, [roomId]);

  // Host/Moderator act directly; participants send a request for approval.
  const act = (type, payload = {}) => {
    if (!socket.connected) return setErr('Not connected to the server. Reconnecting…');
    socket.emit(priv ? type : 'request_action', priv ? payload : { type, payload });
  };
  const commitSeek = () => { if (drag !== null) { act('seek', { time: drag }); setDrag(null); } };
  const skip = (d) => act('seek', { time: Math.max(0, player.current.getCurrentTime() + d) });
  const changeVideo = () => {
    const id = parseVideoId(vurl);
    if (!id) return setErr('That does not look like a YouTube link.');
    setErr(''); act('change_video', { videoId: id }); setVurl('');
  };
  const addQueue = async () => {
    const id = parseVideoId(vurl);
    if (!id) return setErr('That does not look like a YouTube link.');
    setErr(''); setVurl('');
    const t = await fetchTitle(id);
    socket.emit('queue_add', { videoId: id, title: t || `Video ${id}` });
    toast('🎶 Added to queue');
  };
  const changeVolume = (v) => {
    setVolume(v);
    player.current?.setVolume(v);
    if (v > 0 && muted) { player.current?.unMute(); setMuted(false); }
  };
  const toggleMute = () => { muted ? player.current?.unMute() : player.current?.mute(); setMuted(!muted); };
  const sendChat = () => {
    if (!msg.trim()) return;
    if (!socket.connected) return setErr('Not connected to the server. Reconnecting…');
    socket.emit('chat', msg); setMsg('');
  };
  const onType = (e) => {
    setMsg(e.target.value);
    if (Date.now() - typingAt.current > 1500) { typingAt.current = Date.now(); socket.emit('typing'); }
  };
  const copyLink = () => {
    navigator.clipboard.writeText(location.href);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const toggleSound = () => { setSound(!sound); localStorage.setItem('wp-sound', sound ? 'off' : 'on'); };
  const ask = priv ? '' : ' (ask)';
  const typing = Object.keys(typers);

  if (!roomId)
    return (
      <main className="center-page">
        <div className="card wait">
          {online ? <p>Joining room…</p> : (
            <>
              <h2>Cannot reach the server</h2>
              <p>Make sure the backend is running: open a terminal in the <b>backend</b> folder and run <code>npm start</code>.</p>
              <div className="row"><button className="btn" onClick={() => socket.connect()}>Try again</button>
                <button className="btn ghost" onClick={() => onExit()}>Back</button></div>
            </>
          )}
        </div>
      </main>
    );

  return (
    <main className="room">
      <div className="ambient" style={videoId ? { backgroundImage: `url(https://i.ytimg.com/vi/${videoId}/hqdefault.jpg)` } : undefined} />
      <Confetti burst={burst} />
      {!online && <div className="banner">Connection lost. Reconnecting…</div>}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
      <header>
        <div className="brand"><span className="logo">▶</span> Watch Party</div>
        <button className="code-chip" onClick={copyLink} title="Copy invite link">
          Room <b>{roomId}</b> <span>{copied ? '✓ Copied' : '⧉ Copy link'}</span>
        </button>
        <a className="btn ghost sm" target="_blank" rel="noreferrer"
          href={`https://wa.me/?text=${encodeURIComponent(`Join my Watch Party 🎬 ${location.href}`)}`}>💬 Share</a>
        <div className="av-stack" aria-label={`${users.length} people in the room`}>
          {users.slice(0, 5).map((u) => <span key={u.id} title={u.username}><Avatar name={u.username} /></span>)}
          {users.length > 5 && <em>+{users.length - 5}</em>}
        </div>
        <span className={`badge ${myRole}`}>{myRole}</span>
        <button className="btn ghost sm" onClick={toggleSound} title="Sound effects" aria-label="Toggle sound effects">{sound ? '🔔' : '🔕'}</button>
        <span className={`dot ${online ? 'on' : ''}`} title={online ? 'Connected' : 'Disconnected'} />
        <button className="btn ghost sm" onClick={() => onExit()}>Leave</button>
      </header>

      <section className="stage">
        <div className={`video ${playing ? 'playing' : ''}`}>
          <div id="yt" />
          {floats.map((f) => <span key={f.id} className="float" style={{ left: `${f.left}%` }}>{f.emoji}<small>{f.name}</small></span>)}
        </div>
        <p className="now">▶ Now playing: <b>{title || '…'}</b></p>

        <div className="seek">
          <span>{fmtTime(drag ?? progress.t)}</span>
          <input type="range" min="0" max={progress.d || 1} step="1" value={drag ?? progress.t} aria-label="Seek"
            onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek} />
          <span>{fmtTime(progress.d)}</span>
        </div>

        <div className="controls">
          <button className="btn sm" onClick={() => act('play')}>▶ Play{ask}</button>
          <button className="btn sm" onClick={() => act('pause')}>⏸ Pause{ask}</button>
          <button className="btn ghost sm" onClick={() => skip(-10)}>⏪ 10s{ask}</button>
          <button className="btn ghost sm" onClick={() => skip(10)}>10s ⏩{ask}</button>
          <button className="btn ghost sm" onClick={() => socket.emit('resync')} title="Jump back in sync with the room">🔄 Sync me</button>
          <span className="vol">
            <button className="btn ghost sm" onClick={toggleMute} aria-label="Mute">{muted || volume === 0 ? '🔇' : '🔊'}</button>
            <input type="range" min="0" max="100" value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} aria-label="Volume" />
          </span>
          <button className="btn ghost sm" onClick={() => document.querySelector('.video')?.requestFullscreen?.()}>⛶</button>
        </div>
        <div className="emojis">
          {EMOJIS.map((e) => <button key={e} className="emoji" onClick={() => socket.emit('reaction', e)}>{e}</button>)}
        </div>

        <div className="row">
          <input placeholder="Paste a YouTube link…" value={vurl} onChange={(e) => setVurl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && changeVideo()} />
          <button className="btn" onClick={changeVideo}>Play now{ask}</button>
          <button className="btn ghost" onClick={addQueue}>+ Queue</button>
        </div>
        <p className="keys">⌨️ <kbd>Space</kbd> play/pause · <kbd>←</kbd><kbd>→</kbd> ±10s · <kbd>M</kbd> mute · <kbd>F</kbd> fullscreen · <kbd>/</kbd> chat</p>
        {!priv && <p className="hint">👀 You are watching. Play, pause, seek and "Play now" go to the host or a moderator for approval. Anyone can add videos to the queue.</p>}
        {err && <p className="err">{err}</p>}

        {priv && reqs.length > 0 && (
          <div className="card panel">
            <h3>🔔 Requests ({reqs.length})</h3>
            {reqs.map((r) => (
              <div className="item" key={r.id}>
                <Avatar name={r.username} />
                <span><b>{r.username}</b> wants to {describe(r)}</span>
                <button className="btn sm" onClick={() => socket.emit('resolve_request', { requestId: r.id, approve: true })}>Approve</button>
                <button className="btn ghost sm" onClick={() => socket.emit('resolve_request', { requestId: r.id, approve: false })}>Reject</button>
              </div>
            ))}
          </div>
        )}

        <div className="card panel">
          <h3>🎶 Up next ({queue.length})</h3>
          {queue.length === 0 && <p className="sys">Queue is empty. Paste a link and press "+ Queue".</p>}
          {queue.map((q) => (
            <div className="item qitem" key={q.id}>
              <img src={`https://i.ytimg.com/vi/${q.videoId}/default.jpg`} alt="" />
              <span><b>{q.title}</b><small>added by {q.by}</small></span>
              {priv && <button className="btn sm" onClick={() => socket.emit('queue_play', { id: q.id })}>▶ Play</button>}
              {(priv || q.byId === me) && <button className="btn ghost sm" onClick={() => socket.emit('queue_remove', { id: q.id })} aria-label="Remove from queue">✕</button>}
            </div>
          ))}
        </div>
      </section>

      <aside>
        <div className="card panel">
          <h3>👥 People ({users.length})</h3>
          {users.map((u) => (
            <div className="item" key={u.id}>
              <Avatar name={u.username} />
              <span>{u.role === 'host' && '👑 '}{u.username}{u.id === me ? ' (you)' : ''}</span>
              {myRole === 'host' && u.id !== me ? (
                <>
                  <select value={u.role} onChange={(e) => socket.emit('assign_role', { userId: u.id, role: e.target.value })}>
                    <option value="moderator">moderator</option>
                    <option value="participant">participant</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button className="btn ghost sm" onClick={() => socket.emit('transfer_host', { userId: u.id })}>Make host</button>
                  <button className="btn ghost sm" onClick={() => socket.emit('remove_participant', { userId: u.id })}>Remove</button>
                </>
              ) : <span className={`badge ${u.role}`}>{u.role}</span>}
            </div>
          ))}
        </div>
        <div className="card panel">
          <h3>💬 Chat</h3>
          <div className="log" ref={logRef}>
            {chat.length === 0 && <p className="sys">No messages yet. Say hello! 👋</p>}
            {chat.map((m, i) => m.system
              ? <p key={i} className="sys">{m.text}</p>
              : (
                <div key={i} className={`msg ${m.username === mine?.username ? 'mine' : ''}`}>
                  <small>{m.username}{m.ts ? ` · ${new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</small>
                  <p>{m.text}</p>
                </div>
              ))}
          </div>
          <p className="typing">{typing.length > 0 && `${typing.join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`}</p>
          <div className="quick">
            {['😀', '😂', '❤️', '🔥', '👍', '🎉'].map((e) => <button key={e} onClick={() => { setMsg((m) => m + e); inputRef.current?.focus(); }}>{e}</button>)}
          </div>
          <div className="row">
            <input ref={inputRef} placeholder="Say something…" value={msg} onChange={onType} onKeyDown={(e) => e.key === 'Enter' && sendChat()} />
            <button className="btn sm" onClick={sendChat}>Send</button>
          </div>
        </div>
      </aside>
    </main>
  );
}