import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { AjentifyProvider } from '@ajentify/chat';
import { ChatPanel } from '@ajentify/chat/ui';
import { api } from './api';
import { OrdersPage } from './pages/OrdersPage';
import { ProfilePage } from './pages/ProfilePage';
import { HomePage } from './pages/HomePage';

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  const [dark, setDark] = useState(false);

  return (
    <AjentifyProvider
      config={{
        callbacks: {
          createContext: api.createContext,
          getContext: api.getContext,
          generateAccessToken: ({ contextId }) => api.generateAccessToken(contextId),
          getContextHistory: () => api.getContextHistory().then((r) => r.contexts),
        },
        clientSideTools: {
          fallback: async (toolName) => `unhandled client tool: ${toolName}`,
        },
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

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>

        <ChatPanel
          open={chatOpen}
          onOpenChange={setChatOpen}
          desktopVariant="inline"
          autoCreateContext
        />
      </div>
    </AjentifyProvider>
  );
}
