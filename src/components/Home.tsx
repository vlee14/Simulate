import React, { useRef } from 'react';
import { blankDocument, EXAMPLES } from '../model/examples';
import { parseDocument } from '../model/library';
import { SimDocument } from '../model/document';
import { resetSim } from '../sim/controller';
import { confirmClose, useStore } from '../store';

export const Home: React.FC = () => {
  const entries = useStore((state) => state.entries);
  const openModel = useStore((state) => state.openModel);
  const deleteEntry = useStore((state) => state.deleteEntry);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = (model: SimDocument, id: string | null) => {
    resetSim();
    openModel(model, id);
  };

  const openFile = async (file: File) => {
    try {
      const model = parseDocument(JSON.parse(await file.text()));
      open(model, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open that file';
      useStore.getState().setStatus('error', message);
      useStore.setState({ view: 'home', message });
    }
  };

  return (
    <div className="home">
      <header className="home-bar">
        <div className="brand">
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <rect x="4" y="18" width="20" height="4" rx="1" />
            <circle cx="9" cy="23" r="2" />
            <circle cx="19" cy="23" r="2" />
            <path d="M14 18 L18 8" />
            <path d="M18 8 L22 12" />
            <circle cx="18" cy="8" r="1.6" />
            <circle cx="22" cy="12" r="1.6" />
          </svg>
          <div>
            <strong>SIMULATE</strong>
            <em>Block diagrams that run</em>
          </div>
        </div>
        <div className="home-actions">
          <button className="primary" onClick={() => open(blankDocument(), null)}>
            New model
          </button>
          <button onClick={() => fileRef.current?.click()}>Open JSON…</button>
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

      <main className="home-main">
        <section>
          <h2>Your documents</h2>
          <p className="lede">Models you save stay in this browser. Export JSON when you want a file.</p>
          {entries.length === 0 ? (
            <p className="empty">Nothing saved yet. Start a new model, or open an example and save it here.</p>
          ) : (
            <div className="doc-grid">
              {entries.map((entry) => (
                <article key={entry.id} className="doc-card">
                  <h3>{entry.document.name}</h3>
                  <p>{entry.document.description || 'No description'}</p>
                  <footer>
                    <div className="doc-meta">
                      <span>{entry.document.nodes.length} blocks</span>
                      <span>{new Date(entry.updatedAt).toLocaleString()}</span>
                    </div>
                    <button className="primary" onClick={() => open(entry.document, entry.id)}>
                      Open
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete “${entry.document.name}” from this browser?`)) deleteEntry(entry.id);
                      }}
                    >
                      Delete
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2>Examples</h2>
          <p className="lede">Each example is its own document. Opening one makes an unsaved copy you can retune and save.</p>
          <div className="doc-grid">
            {EXAMPLES.map((example) => (
              <article key={example.id} className="doc-card">
                <h3>{example.name}</h3>
                <p>{example.summary}</p>
                <footer>
                  <button
                    className="primary"
                    onClick={() => {
                      if (!confirmClose()) return;
                      open(example.create(), null);
                    }}
                  >
                    Open
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};
