import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
// BandMgtPro shared stage tokens (Phase 2). Side-effect-free: provides the
// --bmp-* geometry/type tokens app-wide; color modes apply only where a subtree
// sets data-stage-theme, so this light workbench app stays visually unchanged.
import '../bandmgtpro-shared/bandmgtpro-theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
