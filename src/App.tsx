import React, { useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { Home } from './components/Home';
import { Inspector } from './components/Inspector';
import { Library } from './components/Library';
import { Toolbar } from './components/Toolbar';
import { installSimulation, resetSim, toggleRun } from './sim/controller';
import { useStore } from './store';

const App: React.FC = () => {
  const view = useStore((state) => state.view);
  const openSerial = useStore((state) => state.openSerial);
  const message = useStore((state) => state.message);
  const status = useStore((state) => state.status);
  const config = useStore((state) => state.config);
  const rate = useStore((state) => state.rate);

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
      <Toolbar />
      {status === 'error' ? <div className="banner">{message}</div> : null}
      <div className="workspace">
        <Library />
        <Canvas key={openSerial} />
        <Inspector />
      </div>
      <footer className="statusbar">
        <span className={status}>{message}</span>
        <span>
          {config.solver.toUpperCase()} · dt {config.stepSize}s · {config.speed}×
          {rate > 0.05 ? ` · ${rate.toFixed(2)} sim s/s` : ''}
        </span>
        <span>Space runs · drag blocks in · wire an output to an input</span>
      </footer>
    </div>
  );
};

export default App;
