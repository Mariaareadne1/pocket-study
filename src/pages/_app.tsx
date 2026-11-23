import type { AppProps } from 'next/app';
import { FONT_VARS } from '@/ui/fonts';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${FONT_VARS} app-root`}>
      <Component {...pageProps} />
    </div>
  );
}
