import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Đăng ký Service Worker khi trang web tải xong (Chỉ đăng ký SW, KHÔNG tự động xin quyền push)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[SafeCheck PWA] Service Worker đăng ký thành công:', registration.scope);
      })
      .catch((err) => {
        console.warn('[SafeCheck PWA] Đăng ký Service Worker thất bại:', err);
      });
  });
}
