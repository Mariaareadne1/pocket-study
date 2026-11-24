import dynamic from 'next/dynamic';
import Head from 'next/head';

const Experience = dynamic(() => import('@/ui/Experience'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Object Study 002 — Handheld</title>
        <meta
          name="description"
          content="A transparent, faintly lavender handheld console you can hold, power on and play — with three original cartridges."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <Experience />
    </>
  );
}
