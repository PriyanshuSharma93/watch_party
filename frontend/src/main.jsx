import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

// Shows a friendly screen instead of a blank page if something unexpected crashes the UI.
class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="center-page">
        <div className="card wait">
          <h2>Something went wrong</h2>
          <p>Please reload the page. If it keeps happening, log out and back in.</p>
          <div className="row">
            <button className="btn" onClick={() => location.reload()}>Reload</button>
            <button className="btn ghost" onClick={() => { localStorage.removeItem('wp-auth'); sessionStorage.removeItem('wp-auth'); location.reload(); }}>Log out</button>
          </div>
        </div>
      </main>
    );
  }
}

createRoot(document.getElementById('root')).render(<Boundary><App /></Boundary>);