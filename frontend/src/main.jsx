import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AppProvider } from './store';
import { apiCall } from './lib/api';

function mount(bootData) {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AppProvider bootData={bootData}>
        <App />
      </AppProvider>
    </StrictMode>
  );
}

// In production, window.frappe.csrf_token is already set synchronously by the
// Jinja injection in index.html ({{ frappe.session.csrf_token }}) before this
// module runs. In dev mode (Vite serves raw HTML without Jinja), we set it below
// from the get_boot_context API response so POST requests still work.
apiCall('matcha.www.matcha.get_boot_context')
  .then((res) => {
    const data = res.message || {};

    // Dev mode: Jinja was not processed, so set the token from the API response.
    if (!window.frappe) window.frappe = {};
    if (!window.frappe.csrf_token || window.frappe.csrf_token.startsWith('{{')) {
      window.frappe.csrf_token = data.csrf_token || '';
      window.csrf_token = window.frappe.csrf_token;
    }

    mount(data);
  })
  .catch(() => {
    mount({});
  });
