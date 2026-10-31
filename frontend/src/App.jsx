import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { API } from './config.js';
import Room from './Room.jsx';

async function api(path, token, body) {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}

const hue = (s = '') => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
const Avatar = ({ name = '?', big }) => (
  <span className={`avatar ${big ? 'big' : ''}`} style={{ background: `hsl(${hue(name)} 70% 60%)` }}>{name[0]?.toUpperCase()}</span>
);
const tilt = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  e.currentTarget.style.transform = `perspective(700px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px)`;
};
const untilt = (e) => { e.currentTarget.style.transform = ''; };
const strength = (p) => [p.length >= 6, p.length >= 10, /[A-Z]/.test(p) && /\d/.test(p), /[^\w\s]/.test(p)].filter(Boolean).length;

function Scene() {
  return (
    <svg viewBox="0 0 520 380" className="scene" role="img" aria-label="Friends watching a video together">
      <defs>
        <linearGradient id="scr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--violet)' }} /><stop offset="1" style={{ stopColor: 'var(--pink)' }} />
        </linearGradient>
      </defs>
      <rect x="60" y="30" width="400" height="225" rx="22" fill="#141831" stroke="rgba(255,255,255,.18)" strokeWidth="2" />
      <rect x="76" y="46" width="368" height="193" rx="14" fill="url(#scr)" />
      <circle cx="260" cy="142" r="38" fill="rgba(255,255,255,.92)" />
      <path d="M249 122 L249 162 L283 142 Z" style={{ fill: 'var(--violet)' }} />
      <rect x="96" y="214" width="328" height="6" rx="3" fill="rgba(255,255,255,.35)" />
      <rect x="96" y="214" width="150" height="6" rx="3" fill="#fff" />
      <rect x="215" y="255" width="90" height="14" fill="#141831" />
      <rect x="170" y="268" width="180" height="10" rx="5" fill="#141831" />
      {[['A', 110, '#ffb454'], ['R', 190, '#4cc9a7'], ['S', 270, '#7c5cff'], ['M', 350, '#ff5d8f']].map(([l, x, c], i) => (
        <g key={l} className="bob" style={{ animationDelay: `${i * 0.3}s` }}>
          <circle cx={x + 20} cy="330" r="26" fill={c} />
          <text x={x + 20} y="338" textAnchor="middle" fontSize="22" fontWeight="800" fill="#12151c">{l}</text>
        </g>
      ))}
    </svg>
  );
}

function Rotator() {
  const words = ['movies', 'music', 'cricket', 'anime', 'podcasts'];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % words.length), 2200); return () => clearInterval(t); }, []);
  return <span key={i} className="grad swap">{words[i]}</span>;
}

function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [shake, setShake] = useState(false);
  const [remember, setRemember] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const signup = mode === 'register';
  const score = strength(f.password);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email);
  const rules = [
    ['6+ characters', f.password.length >= 6],
    ['A capital letter and a number', /[A-Z]/.test(f.password) && /\d/.test(f.password)],
    ['A symbol like ! @ #', /[^\w\s]/.test(f.password)],
  ];
  const switchMode = (m) => { setMode(m); setErr(''); };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const d = await api(`/api/${mode}`, null, f);
      setDone(true);
      setTimeout(() => onAuth(d.token, d.user, remember), 900);
    } catch (x) {
      setErr(x.message === 'Failed to fetch' ? 'The server is waking up or unreachable. Wait a few seconds and try again.' : x.message);
      setShake(true); setTimeout(() => setShake(false), 500);
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="blob b1" /><div className="blob b2" /><div className="blob b3" />
      <section className="hero">
        <div className="brand"><span className="logo">▶</span> Watch Party</div>
        <h1>Watch <Rotator /><br />together.</h1>
        <p>Create a room, share the code, and everyone's YouTube stays perfectly in sync, with live chat and reactions.</p>
        <div className="scene-wrap">
          <Scene />
          <span className="fl f1">🍿</span><span className="fl f2">❤️</span><span className="fl f3">😂</span><span className="fl f4">🔥</span>
          <span className="bub c1">Ready? 🍿</span><span className="bub c2">Hit play! ▶</span><span className="bub c3">LOL 😂</span>
        </div>
        <div className="chips">
          <span>⚡ Real-time sync</span><span>🛡️ Roles & permissions</span><span>💬 Live chat</span><span>🎶 Shared queue</span>
        </div>
      </section>

      <section className="card auth-card">
        <div className={`tabs ${signup ? 'right' : ''}`} role="tablist">
          <i className="pill" />
          <button role="tab" aria-selected={!signup} onClick={() => switchMode('login')}>Log in</button>
          <button role="tab" aria-selected={signup} onClick={() => switchMode('register')}>Sign up</button>
        </div>
        <h2 key={mode} className="pop">{signup ? 'Create your account ✨' : 'Welcome back 👋'}</h2>
        <p className="sub">{signup ? 'Join in under a minute. It is free.' : 'Log in to join or host a watch party.'}</p>

        <form onSubmit={submit} className={`auth-form ${shake ? 'shake' : ''}`}>
          <div className={`collapse ${signup ? 'open' : ''}`}>
            <div>
              <label className="ff">
                <input placeholder=" " autoComplete="name" tabIndex={signup ? 0 : -1} value={f.name} onChange={set('name')} />
                <span className="lbl">Full name</span><span className="ico">👤</span>
                {f.name.trim().length >= 2 && <b className="ok">✓</b>}
              </label>
            </div>
          </div>
          <label className="ff">
            <input placeholder=" " type="email" autoComplete="email" value={f.email} onChange={set('email')} />
            <span className="lbl">Email address</span><span className="ico">✉️</span>
            {emailOk && <b className="ok">✓</b>}
          </label>
          <label className="ff">
            <input placeholder=" " type={show ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} />
            <span className="lbl">Password</span><span className="ico">🔒</span>
            <button type="button" className="eye" onClick={() => setShow(!show)} aria-label="Show or hide password">{show ? '🙈' : '👁️'}</button>
          </label>
          <div className={`collapse ${signup && f.password ? 'open' : ''}`}>
            <div>
              <div className="meter" aria-label="Password strength">
                {[1, 2, 3, 4].map((i) => <i key={i} className={i <= score ? `s${score}` : ''} />)}
                <em>{['', 'Weak', 'Okay', 'Good', 'Strong'][score]}</em>
              </div>
              <ul className="rules">{rules.map(([t, ok]) => <li key={t} className={ok ? 'ok' : ''}><span>{ok ? '✓' : '○'}</span> {t}</li>)}</ul>
            </div>
          </div>
          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me logged in on this device
          </label>
          <button type="submit" className={`btn cta ${done ? 'done' : ''}`} disabled={busy}>
            {done ? '✓ Welcome!' : busy ? <span className="spin" /> : signup ? 'Create account 🚀' : 'Log in →'}
          </button>
        </form>
        {err && <p className="err pop" role="alert">{err}</p>}
        <p className="switch">
          {signup ? 'Already have an account?' : 'New to Watch Party?'}{' '}
          <button className="link" onClick={() => switchMode(signup ? 'login' : 'register')}>{signup ? 'Log in' : 'Sign up free'}</button>
        </p>
      </section>
    </main>
  );
}

function Dashboard({ user, token, onEnter, onLogout, notice, onAuthFail }) {
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room') || '');
  const [rooms, setRooms] = useState([]);
  useEffect(() => {
    api('/api/rooms', token).then((d) => setRooms(d.rooms)).catch((e) => e.status === 401 && onAuthFail());
  }, [token]);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <main className="dash">
      <div className="blob b1" /><div className="blob b2" />
      <header className="topbar">
        <div className="brand"><span className="logo">▶</span> Watch Party</div>
        <div className="me"><Avatar name={user.username} /> <b>{user.username}</b>
          <button className="btn ghost sm" onClick={onLogout}>Log out</button></div>
      </header>
      <h1 className="hello">{greet}, <span className="grad">{user.username.split(' ')[0]}</span> <span className="wave">👋</span></h1>
      <p className="sub">Start a new party or jump into one with a code.</p>
      {notice && <p className="err">{notice}</p>}

      <div className="actions">
        <button className="action create" onClick={() => onEnter(null)} onMouseMove={tilt} onMouseLeave={untilt}>
          <span className="big-emoji">🎬</span>
          <strong>Create a room</strong>
          <small>You become the host with full control.</small>
        </button>
        <div className="action join" onMouseMove={tilt} onMouseLeave={untilt}>
          <span className="big-emoji">🔑</span>
          <strong>Join with a code</strong>
          <div className="row">
            <input placeholder="e.g. 6AYTWM" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && code && onEnter(code)} />
            <button className="btn sm" onClick={() => code && onEnter(code)}>Join</button>
          </div>
        </div>
      </div>

      <div className="steps">
        <div className="card"><b>1</b><span>Create a room and share the code</span></div>
        <div className="card"><b>2</b><span>Friends join and chat live</span></div>
        <div className="card"><b>3</b><span>Everyone watches in perfect sync</span></div>
      </div>

      <h3 className="section">Your rooms</h3>
      {rooms.length === 0 ? (
        <div className="empty card">🍿 No rooms yet. Create one and invite your friends!</div>
      ) : (
        <div className="rooms">
          {rooms.map((r) => (
            <button className="room-card" key={r.id} onClick={() => onEnter(r.id)} onMouseMove={tilt} onMouseLeave={untilt}>
              <img src={`https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`} alt="" onError={(e) => (e.target.style.display = 'none')} />
              <div className="meta"><b>{r.id}</b><span className={`badge ${r.role}`}>{r.role}</span></div>
              <small>Tap to rejoin</small>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

function Screens() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wp-auth') || sessionStorage.getItem('wp-auth')); } catch { return null; }
  });
  const [entry, setEntry] = useState(null); // { code } while inside a room
  const [notice, setNotice] = useState('');
  const socket = useMemo(() => (auth ? io(API, { auth: { token: auth.token }, autoConnect: false }) : null), [auth]);

  // "Keep me logged in" -> localStorage (survives closing the tab); otherwise sessionStorage (this tab only).
  const login = (token, user, remember) => {
    const a = { token, user };
    localStorage.removeItem('wp-auth'); sessionStorage.removeItem('wp-auth');
    (remember ? localStorage : sessionStorage).setItem('wp-auth', JSON.stringify(a));
    setAuth(a);
  };
  const logout = () => { localStorage.removeItem('wp-auth'); sessionStorage.removeItem('wp-auth'); socket?.close(); setAuth(null); setEntry(null); };

  if (!auth) return <AuthPage onAuth={login} />;
  if (entry)
    return (
      <Room
        socket={socket}
        code={entry.code}
        onExit={(msg) => { setNotice(msg || ''); setEntry(null); history.replaceState(null, '', '/'); }}
        onAuthFail={logout}
      />
    );
  return (
    <Dashboard
      user={auth.user}
      token={auth.token}
      notice={notice}
      onAuthFail={logout}
      onLogout={logout}
      onEnter={(code) => { setNotice(''); setEntry({ code }); }}
    />
  );
}

function Splash({ onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 1500); return () => clearTimeout(t); }, []);
  return (
    <div className="splash" aria-hidden="true">
      <span className="logo big">▶</span>
      <b>Watch Party</b>
      <i />
    </div>
  );
}

const THEMES = [['violet', '#7c5cff'], ['ocean', '#22b8cf'], ['sunset', '#ff7a45'], ['forest', '#2fbf71']];

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('wp-theme') || 'violet');
  const [splash, setSplash] = useState(() => !sessionStorage.getItem('wp-splash'));
  // Free hosting sleeps when idle, so wake the backend as soon as the page opens and tell the user.
  const [server, setServer] = useState('checking'); // checking | waking | ready | ok
  useEffect(() => {
    let alive = true, tries = 0, woke = false;
    const hint = setTimeout(() => { if (alive) { woke = true; setServer((s) => (s === 'checking' ? 'waking' : s)); } }, 2500);
    const ping = async () => {
      try {
        const r = await fetch(`${API}/health`);
        if (r.status < 500) {
          if (!alive) return;
          setServer(woke ? 'ready' : 'ok');
          setTimeout(() => alive && setServer('ok'), 2500);
          return;
        }
      } catch { /* server still asleep */ }
      if (alive && ++tries < 40) { woke = true; setServer('waking'); setTimeout(ping, 3000); }
    };
    ping();
    return () => { alive = false; clearTimeout(hint); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('wp-theme', theme); }, [theme]);
  // Spotlight that follows the cursor (see body::before in style.css).
  useEffect(() => {
    const move = (e) => { const st = document.documentElement.style; st.setProperty('--mx', e.clientX + 'px'); st.setProperty('--my', e.clientY + 'px'); };
    move({ clientX: innerWidth / 2, clientY: innerHeight / 3 });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  return (
    <>
      <Screens />
      {(server === 'waking' || server === 'ready') && (
        <div className={`wake ${server}`} role="status">
          {server === 'waking' ? <><span className="spin" /> Waking up the server. Free hosting sleeps when idle, this can take up to a minute…</> : '✅ Server is ready'}
        </div>
      )}
      {splash && <Splash onDone={() => { sessionStorage.setItem('wp-splash', '1'); setSplash(false); }} />}
      <div className="dock" role="group" aria-label="Colour theme">
        {THEMES.map(([name, color]) => (
          <button key={name} className={theme === name ? 'on' : ''} style={{ background: color }} onClick={() => setTheme(name)} title={`${name} theme`} aria-label={`${name} theme`} />
        ))}
      </div>
    </>
  );
}