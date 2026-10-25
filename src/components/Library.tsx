import React, { useMemo, useState } from 'react';
import { libraryGroups } from '../engine/blocks';
import { useStore } from '../store';
import { CATEGORY_COLOR } from '../ui';
import { flowApi } from '../sim/flow';

export const Library: React.FC = () => {
  const addBlock = useStore((state) => state.addBlock);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return libraryGroups()
      .map((group) => ({
        ...group,
        blocks: group.blocks.filter((block) => {
          if (!needle) return true;
          return `${block.name} ${block.description} ${block.category}`.toLowerCase().includes(needle);
        }),
      }))
      .filter((group) => group.blocks.length > 0);
  }, [query]);

  const place = (blockType: string) => {
    const host = document.querySelector('.canvas-wrap');
    const rect = host?.getBoundingClientRect();
    const position =
      flowApi && rect
        ? flowApi.project({
            x: rect.width * 0.45 + Math.random() * 48,
            y: rect.height * 0.35 + Math.random() * 48,
          })
        : { x: 160 + Math.random() * 40, y: 120 + Math.random() * 40 };
    addBlock(blockType, position);
  };

  return (
    <aside className="library">
      <div className="panel-label">Library</div>
      <input
        className="search"
        placeholder="Search blocks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="library-scroll">
        {groups.map((group) => (
          <section key={group.category}>
            <h3>{group.category}</h3>
            {group.blocks.map((block) => (
              <button
                key={block.type}
                className="lib-item"
                draggable
                title={block.description}
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/simulate', block.type);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => place(block.type)}
              >
                <i style={{ background: CATEGORY_COLOR[block.category] }} />
                <span>
                  <strong>{block.name}</strong>
                  <em>{block.description}</em>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
};
