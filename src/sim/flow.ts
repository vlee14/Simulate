import { OnLoadParams } from 'react-flow-renderer';

export let flowApi: OnLoadParams | null = null;

export function setFlowApi(api: OnLoadParams | null): void {
  flowApi = api;
}

export function fitDiagram(): void {
  window.setTimeout(() => flowApi?.fitView({ padding: 0.18 }), 40);
}
