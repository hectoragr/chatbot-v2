import '@cloudscape-design/global-styles/index.css';
import './globals.css';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata = {
  title: {
    default: 'Chat · chat.hectoragomez.com',
    template: '%s · chat.hectoragomez.com',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
