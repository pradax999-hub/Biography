import { useEffect } from 'react';
import { ChapterRail } from './components/ChapterRail';
import { Cursor } from './components/Cursor';
import { Nav } from './components/Nav';
import { Preloader } from './components/Preloader';
import { Scene } from './components/Scene';
import { ToastProvider } from './components/Toast';
import { I18nProvider, useI18n } from './i18n/I18nProvider';
import { ScrollTrigger, startSmoothScroll } from './lib/motion';
import { OrderProvider } from './order/OrderContext';
import { Archive } from './sections/Archive';
import { Connection } from './sections/Connection';
import { Creator, Languages, Path, Skills } from './sections/Creator';
import { Hero } from './sections/Hero';
import { Order } from './sections/Order';
import { Services } from './sections/Services';

function Page() {
  const { lang } = useI18n();

  useEffect(() => startSmoothScroll(), []);

  // text length changes with the language, and with it every scroll position
  useEffect(() => {
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    return () => window.clearTimeout(id);
  }, [lang]);

  return (
    <>
      <Scene />
      <div className="grain" aria-hidden="true" />
      <Nav />
      <ChapterRail />
      <main id="main">
        <Hero />
        <Creator />
        <Skills />
        <Languages />
        <Path />
        <Archive />
        <Services />
        <Order />
        <Connection />
      </main>
      <Cursor />
      <Preloader />
    </>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <OrderProvider>
          <Page />
        </OrderProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
