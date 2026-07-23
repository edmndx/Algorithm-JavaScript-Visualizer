import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './assets/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing element: <div id="root"></div>');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
