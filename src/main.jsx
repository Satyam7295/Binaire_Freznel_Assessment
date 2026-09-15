import { createRoot } from 'react-dom/client';
import { Provider, defaultTheme } from '@adobe/react-spectrum';
import App from './components/App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <Provider theme={defaultTheme}>
    <App />
  </Provider>
);