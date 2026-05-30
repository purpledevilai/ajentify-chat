import type { Metadata } from 'next';
import { Providers } from './providers';
import { TopBar } from './_components/TopBar';
import { ChatLayer } from './_components/ChatLayer';

import '@ajentify/chat/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ajentify Chat — Next.js Example',
  description: 'Demo of @ajentify/chat in a Next.js App Router app',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="app">
            <TopBar />
            <ChatLayer>{children}</ChatLayer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
