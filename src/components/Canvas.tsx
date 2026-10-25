import React, { useEffect, useRef, useState } from 'react';
import ReactFlow, { Background, BackgroundVariant, ConnectionLineType, Controls } from 'react-flow-renderer';
import { flowApi, setFlowApi } from '../sim/flow';
import { useStore } from '../store';
import { Dock } from './Dock';
import { nodeTypes } from './nodes';

export const Canvas: React.FC = () => {
  const elements = useStore((state) => state.elements);
  const connect = useStore((state) => state.connect);
  const updatePosition = useStore((state) => state.updatePosition);
  const updatePositions = useStore((state) => state.updatePositions);
  const setSelected = useStore((state) => state.setSelected);
  const addBlock = useStore((state) => state.addBlock);
  const wrap = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const first = window.setTimeout(() => flowApi?.fitView({ padding: 0.16 }), 80);
    const second = window.setTimeout(() => flowApi?.fitView({ padding: 0.16 }), 350);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [ready]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const blockType = event.dataTransfer.getData('application/simulate');
    const bounds = wrap.current?.getBoundingClientRect();
    if (!blockType || !bounds) return;
    const position = flowApi
      ? flowApi.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
      : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    addBlock(blockType, position);
  };

  return (
    <div
      className="canvas-wrap"
      ref={wrap}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        elements={elements}
        nodeTypes={nodeTypes}
        onLoad={(instance) => {
          setFlowApi(instance);
          setReady(true);
        }}
        onConnect={connect}
        onNodeDragStop={(_, node) => updatePosition(node.id, node.position.x, node.position.y)}
        onSelectionDragStop={(_, nodes) => updatePositions(nodes)}
        onSelectionChange={(selected) => setSelected((selected ?? []).map((element) => element.id))}
        onPaneClick={() => setSelected([])}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        deleteKeyCode={'F15'}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: '#e7a23a', strokeWidth: 1.6 }}
        arrowHeadColor="#8b97a8"
        minZoom={0.25}
        maxZoom={1.6}
        zoomOnScroll
        panOnScroll={false}
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#243041" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <Dock />
    </div>
  );
};
