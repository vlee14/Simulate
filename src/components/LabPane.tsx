import React, { useMemo, useState } from 'react';
import {
  campaignToJson,
  envelopeToCsv,
  experimentToJson,
  sensitivityToJson,
  shareUrlForDocument,
  traceToCsv,
} from '../engine/exportShare';
import { ExperimentKind } from '../engine/experiments';
import { toGraph } from '../model/elements';
import {
  placeControllerPoles,
  runSensitivityStudy,
  runTimeExperiment,
  tunePid,
} from '../sim/controller';
import { useStore } from '../store';
import { downloadText } from '../ui';

export function LabPane() {
  const elements = useStore((s) => s.elements);
  const experiment = useStore((s) => s.experimentResult);
  const sensitivity = useStore((s) => s.sensitivityResult);
  const designView = useStore((s) => s.designView);
  const document = useStore((s) => s.document);

  const graph = useMemo(() => toGraph(elements), [elements]);
  const outputOptions = useMemo(() => {
    const opts: { block: string; port: string; label: string }[] = [];
    for (const node of graph.nodes) {
      if (node.blockType === 'scope' || node.blockType === 'meter') {
        opts.push({ block: node.id, port: 'in0', label: `${node.id} (sink)` });
      }
      if (['secondorder', 'mass', 'dcmotor', 'ode', 'statespace', 'pneumatic_tank'].includes(node.blockType)) {
        opts.push({
          block: node.id,
          port:
            node.blockType === 'secondorder' || node.blockType === 'mass'
              ? 'y'
              : node.blockType === 'dcmotor'
                ? 'w'
                : node.blockType === 'pneumatic_tank'
                  ? 'p'
                  : 'y0',
          label: node.id,
        });
      }
    }
    return opts;
  }, [graph.nodes]);
  const inputOptions = useMemo(
    () =>
      graph.nodes
        .filter((n) => ['step', 'pulse', 'constant', 'manual'].includes(n.blockType))
        .map((n) => ({ id: n.id, label: `${n.id} (${n.blockType})` })),
    [graph.nodes]
  );

  const [kind, setKind] = useState<ExperimentKind>('step');
  const [outIdx, setOutIdx] = useState(0);
  const [inIdx, setInIdx] = useState(0);
  const [mcRuns, setMcRuns] = useState(48);
  const [poles, setPoles] = useState('-2 -3');
  const [metric, setMetric] = useState<'riseTime' | 'settlingTime' | 'overshoot' | 'peak'>('settlingTime');
  const [shareMsg, setShareMsg] = useState('');

  const out = outputOptions[Math.min(outIdx, Math.max(0, outputOptions.length - 1))];
  const inp = inputOptions[Math.min(inIdx, Math.max(0, inputOptions.length - 1))];

  return (
    <div className="pane">
      <h2>Lab</h2>

      <h3>Experiment</h3>
      <label className="field">
        <span>Kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as ExperimentKind)}>
          <option value="step">Step</option>
          <option value="impulse">Impulse / pulse</option>
          <option value="free">Free response</option>
        </select>
      </label>
      <label className="field">
        <span>Output</span>
        <select value={outIdx} onChange={(e) => setOutIdx(Number(e.target.value))}>
          {outputOptions.map((o, i) => (
            <option key={`${o.block}:${o.port}`} value={i}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Input drive</span>
        <select value={inIdx} onChange={(e) => setInIdx(Number(e.target.value))}>
          {inputOptions.map((o, i) => (
            <option key={o.id} value={i}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Monte Carlo runs</span>
        <input type="number" min={0} max={500} value={mcRuns} onChange={(e) => setMcRuns(Math.max(0, Number(e.target.value) || 0))} />
      </label>
      <div className="design-actions">
        <button
          type="button"
          className="primary wide"
          disabled={!out}
          onClick={() =>
            out &&
            runTimeExperiment({
              kind,
              outputBlock: out.block,
              outputPort: out.port,
              inputBlock: inp?.id,
              mcRuns,
            })
          }
        >
          Run experiment
        </button>
      </div>
      {experiment ? (
        <ul className="gain-list report-summary">
          {experiment.summary.map((line) => (
            <li key={line}>
              <span>{line}</span>
            </li>
          ))}
          <li>
            <span>tr / ts / Mp</span>
            <span>
              {experiment.nominal.metrics.riseTime?.toFixed(3) ?? '—'} / {experiment.nominal.metrics.settlingTime?.toFixed(3) ?? '—'} /{' '}
              {experiment.nominal.metrics.overshoot?.toFixed(1) ?? '—'}%
            </span>
          </li>
        </ul>
      ) : null}

      <h3>Sensitivity</h3>
      <label className="field">
        <span>Metric</span>
        <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
          <option value="settlingTime">Settling time</option>
          <option value="riseTime">Rise time</option>
          <option value="overshoot">Overshoot %</option>
          <option value="peak">Peak</option>
        </select>
      </label>
      <div className="design-actions">
        <button
          type="button"
          className="ghost wide"
          disabled={!out}
          onClick={() =>
            out &&
            runSensitivityStudy({
              outputBlock: out.block,
              outputPort: out.port,
              inputBlock: inp?.id,
              metric,
            })
          }
        >
          Run sensitivity
        </button>
      </div>
      {sensitivity ? (
        <>
          <ul className="gain-list report-summary">
            {sensitivity.summary.map((line) => (
              <li key={line}>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {sensitivity.tornado.slice(0, 6).map((bar) => (
            <div key={bar.id} className="hint">
              {bar.label}: {bar.effect.toFixed(3)}
            </div>
          ))}
        </>
      ) : null}

      <h3>Quick tune</h3>
      <p className="hint">More controllers are on Design.</p>
      <div className="design-actions stacked">
        <button type="button" className="ghost wide" onClick={() => tunePid('imc')}>
          Tune PID (IMC)
        </button>
        <button type="button" className="ghost wide" onClick={() => tunePid('zn')}>
          Tune PID (Z–N)
        </button>
      </div>
      <label className="field">
        <span>Desired poles</span>
        <input value={poles} onChange={(e) => setPoles(e.target.value)} placeholder="-2 -3 or -1±2j" />
      </label>
      <div className="design-actions">
        <button type="button" className="ghost wide" onClick={() => placeControllerPoles(poles)}>
          Place poles
        </button>
      </div>

      <h3>Export & share</h3>
      <div className="design-actions stacked">
        <button
          type="button"
          className="ghost wide"
          disabled={!experiment}
          onClick={() => experiment && downloadText('experiment.json', experimentToJson(experiment), 'application/json')}
        >
          Export experiment JSON
        </button>
        <button
          type="button"
          className="ghost wide"
          disabled={!experiment}
          onClick={() =>
            experiment &&
            downloadText('experiment-trace.csv', traceToCsv(experiment.nominal.trace.t, experiment.nominal.trace.y), 'text/csv')
          }
        >
          Export nominal CSV
        </button>
        <button
          type="button"
          className="ghost wide"
          disabled={!experiment?.envelope}
          onClick={() => experiment?.envelope && downloadText('experiment-envelope.csv', envelopeToCsv(experiment.envelope), 'text/csv')}
        >
          Export envelope CSV
        </button>
        <button
          type="button"
          className="ghost wide"
          disabled={!sensitivity}
          onClick={() => sensitivity && downloadText('sensitivity.json', sensitivityToJson(sensitivity), 'application/json')}
        >
          Export sensitivity JSON
        </button>
        <button
          type="button"
          className="ghost wide"
          disabled={!designView?.mcCampaign}
          onClick={() =>
            designView?.mcCampaign && downloadText('mc-campaign.json', campaignToJson(designView.mcCampaign), 'application/json')
          }
        >
          Export MC campaign JSON
        </button>
        <button
          type="button"
          className="primary wide"
          onClick={async () => {
            const url = shareUrlForDocument(document());
            try {
              await navigator.clipboard.writeText(url);
              setShareMsg('Share link copied to clipboard.');
            } catch {
              setShareMsg(url);
            }
          }}
        >
          Copy share link
        </button>
      </div>
      {shareMsg ? <p className="hint">{shareMsg}</p> : null}
      <p className="hint">Link includes the model. Open it from Home.</p>
    </div>
  );
}
