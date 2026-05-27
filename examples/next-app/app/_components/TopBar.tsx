'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useChatPanel } from '../providers';

export function TopBar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { open, toggle } = useChatPanel();

  return (
    <div className="topbar">
      <div className="brand">
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          Acme Ops (Next)
        </Link>
      </div>
      <nav className="nav">
        <Link href="/" className={pathname === '/' ? 'active' : ''}>
          Home
        </Link>
        <Link href="/orders" className={pathname?.startsWith('/orders') ? 'active' : ''}>
          Orders
        </Link>
        <Link href="/profile" className={pathname?.startsWith('/profile') ? 'active' : ''}>
          Profile
        </Link>
      </nav>
      <div className="topbar-right">
        <button
          className="btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </button>
        <button className="btn" onClick={toggle}>
          {open ? 'Close chat' : 'Open chat'}
        </button>
      </div>
    </div>
  );
}
