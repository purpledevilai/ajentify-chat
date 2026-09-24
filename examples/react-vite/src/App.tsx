import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { AjentifyProvider } from '@ajentify/chat';
import { ChatPanel } from '@ajentify/chat/ui';
import { onAjentifyProxyRequest } from './api';
import { OrdersPage } from './pages/OrdersPage';
import { ProfilePage } from './pages/ProfilePage';
import { HomePage } from './pages/HomePage';

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const navigate = useNavigate();

  // Toggle the `dark` class on <html> so the same selector strategy used by
  // the chat package (`.dark { --aj-* }`) and our own page chrome works
  // everywhere. Putting it on a div would only affect descendants and would
  // miss e.g. `body { background: ... }` in our stylesheet.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

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
        websocketUrl: 'ws://localhost:8084/ws',
        onAjentifyProxyRequest,
        clientSideTools,
        onError: (err) => {
          console.error('[ajentify]', err);
        },
        // themeBridge: {
        //   tokens: {
        //     background: '--app-background',
        //     foreground: '--app-foreground',
        //     card: '--app-card',
        //     'card-foreground': '--app-card-foreground',
        //     popover: '--app-popover',
        //     'popover-foreground': '--app-popover-foreground',
        //     primary: '--app-primary',
        //     'primary-foreground': '--app-primary-foreground',
        //     secondary: '--app-secondary',
        //     'secondary-foreground': '--app-secondary-foreground',
        //     muted: '--app-muted',
        //     'muted-foreground': '--app-muted-foreground',
        //     accent: '--app-accent',
        //     'accent-foreground': '--app-accent-foreground',
        //     destructive: '--app-destructive',
        //     'destructive-foreground': '--app-destructive-foreground',
        //     border: '--app-border',
        //     input: '--app-input',
        //     ring: '--app-ring',
        //     radius: '--app-radius',
        //   },
        // },
      }}
    >
      <div className="app">
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
