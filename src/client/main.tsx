import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast/Toast';
import './styles/terminal.css';

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
