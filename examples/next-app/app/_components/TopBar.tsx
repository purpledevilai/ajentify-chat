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
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/90 px-5 py-3 backdrop-blur">
      <div className="font-bold tracking-tight">
        <Link href="/" className="text-foreground no-underline">
          Acme Ops (Next)
        </Link>
      </div>
      <nav className="flex items-center gap-4 text-sm">
        <NavLink href="/" active={pathname === '/'}>
          Home
        </NavLink>
        <NavLink href="/orders" active={pathname?.startsWith('/orders') ?? false}>
          Orders
        </NavLink>
        <NavLink href="/profile" active={pathname?.startsWith('/profile') ?? false}>
          Profile
        </NavLink>
      </nav>
      <div className="flex items-center gap-2">
        <Button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
        </Button>
        <Button onClick={toggle}>{open ? 'Close chat' : 'Open chat'}</Button>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'font-semibold text-foreground'
          : 'text-muted-foreground transition-colors hover:text-foreground'
      }
    >
      {children}
    </Link>
  );
}

function Button({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  );
}
