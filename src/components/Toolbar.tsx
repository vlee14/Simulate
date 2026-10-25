import React, { useRef, useState } from 'react';
import { EXAMPLES, blankDocument } from '../model/examples';
import { parseDocument } from '../model/library';
import { fitDiagram } from '../sim/flow';
import { pause, play, resetSim } from '../sim/controller';
import { confirmClose, useStore } from '../store';
import { downloadText, formatTime } from '../ui';

export const Toolbar: React.FC = () => {
  const status = useStore((state) => state.status);
  const time = useStore((state) => state.time);
  const name = useStore((state) => state.name);
  const dirty = useStore((state) => state.dirty);
  const config = useStore((state) => state.config);
  const setConfig = useStore((state) => state.setConfig);
  const setMeta = useStore((state) => state.setMeta);
  const openModel = useStore((state) => state.openModel);
  const saveLibrary = useStore((state) => state.saveLibrary);
  const saveLibraryCopy = useStore((state) => state.saveLibraryCopy);
  const closeToHome = useStore((state) => state.closeToHome);
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = status === 'running';

  const openFresh = (create: () => ReturnType<typeof blankDocument>) => {
    if (!confirmClose()) return;
    resetSim();
    openModel(create(), null);
    setMenu(false);
    fitDiagram();
  };

  const leave = () => {
    if (!confirmClose()) return;
    resetSim();
    closeToHome();
    setMenu(false);
  };

  const saveFile = () => {
    const state = useStore.getState();
    const doc = state.document();
    downloadText(`${doc.name.replace(/\s+/g, '-').toLowerCase()}.simulate.json`, JSON.stringify(doc, null, 2), 'application/json');
    setMenu(false);
  };

  const openFile = async (file: File) => {
    try {
      const model = parseDocument(JSON.parse(await file.text()));
      if (!confirmClose()) return;
      resetSim();
      openModel(model, null);
      fitDiagram();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open that file';
      useStore.getState().setStatus('error', message);
    }
    setMenu(false);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <button className="brand-mark" onClick={leave} title="Documents">
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <rect x="4" y="18" width="20" height="4" rx="1" />
            <circle cx="9" cy="23" r="2" />
            <circle cx="19" cy="23" r="2" />
            <path d="M14 18 L18 8" />
            <path d="M18 8 L22 12" />
            <circle cx="18" cy="8" r="1.6" />
            <circle cx="22" cy="12" r="1.6" />
          </svg>
        </button>
        <div className="doc-title">
          <strong>SIMULATE</strong>
          <input aria-label="Document name" value={name} onChange={(event) => setMeta({ name: event.target.value })} />
          {dirty ? <i title="Unsaved changes" /> : null}
        </div>
      </div>

      <div className="transport">
        <button className={running ? 'play on' : 'play'} onClick={() => (running ? pause() : play())}>
          {running ? 'Pause' : status === 'paused' ? 'Resume' : 'Run'}
        </button>
        <button onClick={() => resetSim()}>Reset</button>
        <div className="clock">{formatTime(time)}</div>
      </div>

      <div className="top-actions">
        <label className="mini">
          Solver
          <select value={config.solver} onChange={(event) => setConfig({ solver: event.target.value as 'rk4' | 'euler' })}>
            <option value="rk4">RK4</option>
            <option value="euler">Euler</option>
          </select>
        </label>
        <label className="mini">
          Speed
          <select value={String(config.speed)} onChange={(event) => setConfig({ speed: Number(event.target.value) })}>
            {[0.25, 0.5, 1, 2, 4].map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => fitDiagram()}>Fit</button>
        <button onClick={() => saveLibrary()}>Save</button>
        <div className="menu-wrap">
          <button onClick={() => setMenu((open) => !open)}>File</button>
          {menu ? (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => openFresh(blankDocument)}>New model</button>
              <button onClick={leave}>All documents</button>
              <button
                onClick={() => {
                  saveLibrary();
                  setMenu(false);
                }}
              >
                Save to this browser
              </button>
              <button
                onClick={() => {
                  saveLibraryCopy();
                  setMenu(false);
                }}
              >
                Save a copy
              </button>
              <button onClick={saveFile}>Export JSON…</button>
              <button onClick={() => fileRef.current?.click()}>Open JSON…</button>
              <p>Examples</p>
              {EXAMPLES.map((example) => (
                <button key={example.id} onClick={() => openFresh(example.create)}>
                  {example.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openFile(file);
            event.target.value = '';
          }}
        />
      </div>
    </header>
  );
};
