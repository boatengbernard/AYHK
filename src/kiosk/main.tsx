import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Kiosk from './App.tsx';
import './kiosk.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Kiosk />
  </StrictMode>,
);
