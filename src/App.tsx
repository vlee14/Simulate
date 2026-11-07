import React, { useEffect, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Home } from './components/Home';
import { Inspector } from './components/Inspector';
import { Library } from './components/Library';
import { Toolbar } from './components/Toolbar';
import { parseDocument } from './model/library';
import { readShareFromLocation } from './engine/exportShare';
import { installSimulation, resetSim, toggleRun } from './sim/controller';
import { useStore } from './store';
import { COMPACT_LAYOUT, useMediaQuery } from './ui';

const App: React.FC = () => {
  const view = useStore((state) => state.view);
  const openSerial = useStore((state) => state.openSerial);
  const message = useStore((state) => state.message);
  const status = useStore((state) => state.status);
  const config = useStore((state) => state.config);
  const rate = useStore((state) => state.rate);
  const compact = useMediaQuery(COMPACT_LAYOUT);
  const [drawer, setDrawer] = useState<'library' | 'inspector' | null>(null);

  const toggleDrawer = (panel: 'library' | 'inspector') => {
    setDrawer((current) => (current === panel ? null : panel));
  };

  useEffect(() => {
    // Load shared model from #model=… once on boot
    try {
      const shared = readShareFromLocation();
      if (shared) {
        const model = parseDocument(shared);
        resetSim();
        useStore.getState().openModel(model, null);
        useStore.getState().setStatus('idle', `Opened shared model “${model.name}”`);
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open shared model';
      useStore.getState().setStatus('error', message);
    }
  }, []);

  useEffect(() => {
    installSimulation();
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (typing) return;
      if ((event.key === ' ' || event.code === 'Space') && useStore.getState().view === 'editor') {
        event.preventDefault();
        toggleRun();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        useStore.getState().redo();
        return;
      }
      if (useStore.getState().view === 'editor' && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        const ids = useStore.getState().selectedIds;
        if (ids.length) {
          resetSim();
          useStore.getState().removeIds(ids);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (view === 'home') setDrawer(null);
  }, [view]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  if (view === 'home') {
    return (
      <div className="app">
        {status === 'error' ? <div className="banner">{message}</div> : null}
        <Home />
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar drawer={drawer} onToggleDrawer={toggleDrawer} />
      {status === 'error' ? <div className="banner">{message}</div> : null}
      <div className="workspace">
        <Library mobileOpen={drawer === 'library'} compact={compact} onClose={() => setDrawer(null)} />
        <Canvas key={openSerial} />
        <Inspector mobileOpen={drawer === 'inspector'} compact={compact} onClose={() => setDrawer(null)} />
        {drawer ? (
          <button type="button" className="drawer-backdrop" aria-label="Close panel" onClick={() => setDrawer(null)} />
        ) : null}
      </div>
      <footer className="statusbar">
        <span className={status}>{message}</span>
        <span>
          {config.solver.toUpperCase()} · dt {config.stepSize}s · {config.speed}×
          {rate > 0.05 ? ` · ${rate.toFixed(2)} sim s/s` : ''}
        </span>
        <span className="status-hint">Space runs · drag blocks in · wire an output to an input</span>
      </footer>
    </div>
  );
};

export default App;
