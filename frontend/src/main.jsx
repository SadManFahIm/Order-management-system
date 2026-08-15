import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './theme/ThemeContext';
import { PaperThemeProvider } from './theme/PaperThemeContext';
import { I18nProvider } from './i18n';
import { ToastProvider } from './components/ui';

import './theme/tokens.css';
import './components/ui/ui.css';
import './styles/app.css';
import './styles/landing.css';
import './styles/storefront.css';
import './styles/storefront-checkout.css';
import './styles/invoice-ink.css';
import './styles/diner-receipt-ink.css';
import './styles/table-qr-ticket.css';
import './styles/split-panel-ink.css';
import './styles/dashboard-ink.css';
import './styles/auth-ticket.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <PaperThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </I18nProvider>
      </PaperThemeProvider>
    </ThemeProvider>
  </React.StrictMode>
);
