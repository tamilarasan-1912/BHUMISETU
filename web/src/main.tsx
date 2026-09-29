import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/design-system.css';
import { AppStateProvider } from './app/AppState';
import { AppRoutes } from './app/AppRoutes';

const container = document.getElementById('root');
if (!container) throw new Error('BHUMISETU: #root container is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AppStateProvider>
        <AppRoutes />
      </AppStateProvider>
    </BrowserRouter>
  </StrictMode>,
);
