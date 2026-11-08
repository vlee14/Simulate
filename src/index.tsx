import React from 'react';
import ReactDOM from 'react-dom';
import 'react-flow-renderer/dist/style.css';
import { applyAppearance, getAppearance } from './appearance';
import App from './App';
import './styles.css';

applyAppearance(getAppearance());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getAppearance() === 'system') applyAppearance('system');
});

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
