import React, { useMemo, useState } from 'react';
import { libraryGroups } from '../engine/blocks';
import { useStore } from '../store';
import { CATEGORY_COLOR } from '../ui';
import { flowApi } from '../sim/flow';
import { ShapeMark } from './shapes';

export const Library: React.FC<{ mobileOpen: boolean; compact: boolean; onClose: () => void }> = ({
  mobileOpen,
  compact,
  onClose,
}) => {
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
    <aside className={mobileOpen ? 'library mobile-open' : 'library'} aria-hidden={compact && !mobileOpen}>
      <div className="panel-head">
        <div className="panel-label">Library</div>
        <button type="button" className="drawer-close" onClick={onClose}>
          Close
        </button>
      </div>
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
                onClick={() => {
                  place(block.type);
                  if (compact) onClose();
                }}
              >
                <ShapeMark type={block.type} color={CATEGORY_COLOR[block.category] ?? '#8b97a8'} />
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
