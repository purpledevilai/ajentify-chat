import { useCallback, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { AjentifyProvider } from '@ajentify/chat';
import { ChatPanel } from '@ajentify/chat/ui';
import { ajentifyEvent } from './api';
import { OrdersPage } from './pages/OrdersPage';
import { ProfilePage } from './pages/ProfilePage';
import { HomePage } from './pages/HomePage';

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const navigate = useNavigate();

  // Catch-all for client-side tools. We route the built-in `navigate` tool
  // through React Router's `useNavigate` so the agent can move the user
  // between pages without a full reload.
  const clientSideTools = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      if (toolName === 'navigate') {
        const path =
          (args.path as string | undefined) ??
          (args.route as string | undefined) ??
          (args.url as string | undefined);
        if (!path) {
          return { ok: false, error: 'navigate is missing a `path` argument' };
        }
        navigate(path);
        return { ok: true, path };
      }
      return `unhandled client tool: ${toolName}`;
    },
    [navigate]
  );

  return (
    <AjentifyProvider
      config={{
        onAjentifyEvent: ajentifyEvent,
        clientSideTools,
        onError: (err) => {
          console.error('[ajentify]', err);
        },
      }}
    >
      <div className={`app ${dark ? 'dark' : ''}`}>
        <div className="topbar">
          <div className="brand">
            <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
              Acme Ops
            </Link>
          </div>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              Home
            </NavLink>
            <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
              Orders
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
              Profile
            </NavLink>
          </nav>
          <div className="topbar-right">
            <button className="btn" onClick={() => setDark((d) => !d)}>
              {dark ? '☀ Light' : '🌙 Dark'}
            </button>
            <button className="btn" onClick={() => setChatOpen((o) => !o)}>
              {chatOpen ? 'Close chat' : 'Open chat'}
            </button>
          </div>
        </div>

        <ChatPanel
          open={chatOpen}
          onOpenChange={setChatOpen}
          desktopVariant="inline"
          autoCreateContext
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Routes>
        </ChatPanel>
      </div>
    </AjentifyProvider>
  );
}
