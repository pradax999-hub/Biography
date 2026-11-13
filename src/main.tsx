import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/unbounded/wght.css';
import '@fontsource-variable/onest/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource/cormorant/400-italic.css';
import '@fontsource/cormorant/500-italic.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/sections.css';
import './styles/order.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
