import React, { useMemo, useState } from 'react';
import { libraryGroups } from '../engine/blocks';
import { PLANT_RECIPES, recipeSubsystemNode } from '../model/builder';
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
  const insertGraph = useStore((state) => state.insertGraph);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'blocks' | 'plants'>('blocks');
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

  const recipes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PLANT_RECIPES.filter((recipe) => {
      if (!needle) return true;
      return `${recipe.name} ${recipe.summary} ${recipe.domain}`.toLowerCase().includes(needle);
    });
  }, [query]);

  const origin = () => {
    const host = document.querySelector('.canvas-wrap');
    const rect = host?.getBoundingClientRect();
    return flowApi && rect
      ? flowApi.project({
          x: rect.width * 0.2,
          y: rect.height * 0.2,
        })
      : { x: 80, y: 80 };
  };

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

  const insertRecipe = (id: string, asSubsystem: boolean) => {
    const recipe = PLANT_RECIPES.find((item) => item.id === id);
    if (!recipe) return;
    const base = origin();
    if (asSubsystem) {
      const node = recipeSubsystemNode(recipe, base);
      if (!node) {
        useStore.getState().setStatus(useStore.getState().status, 'This recipe has no subsystem package.');
        return;
      }
      insertGraph([node], []);
    } else {
      const graph = recipe.create(base);
      insertGraph(graph.nodes, graph.edges);
    }
    if (compact) onClose();
  };

  return (
    <aside className={mobileOpen ? 'library mobile-open' : 'library'} aria-hidden={compact && !mobileOpen}>
      <div className="panel-head">
        <div className="panel-label">Library</div>
        <button type="button" className="drawer-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="tabs library-tabs">
        <button className={tab === 'blocks' ? 'on' : ''} onClick={() => setTab('blocks')}>
          Blocks
        </button>
        <button className={tab === 'plants' ? 'on' : ''} onClick={() => setTab('plants')}>
          Plant builder
        </button>
      </div>
      <input
        className="search"
        placeholder={tab === 'plants' ? 'Search plants' : 'Search blocks'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="library-scroll">
        {tab === 'plants' ? (
          <section>
            <h3>Recipes</h3>
            <p className="lede" style={{ padding: '0 10px 8px', fontSize: 12 }}>
              Drop a wired plant with actuators, sensors, and Stage animation — or package it as one Subsystem block.
            </p>
            {recipes.map((recipe) => (
              <div key={recipe.id} className="lib-item plant-recipe">
                <ShapeMark type="ode" color={CATEGORY_COLOR.Dynamics} />
                <span>
                  <strong>{recipe.name}</strong>
                  <em>{recipe.summary}</em>
                  <span className="recipe-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => insertRecipe(recipe.id, false)}
                    >
                      Insert
                    </button>
                    {recipe.blueprint ? (
                      <button type="button" onClick={() => insertRecipe(recipe.id, true)}>
                        As subsystem
                      </button>
                    ) : null}
                  </span>
                </span>
              </div>
            ))}
          </section>
        ) : (
          groups.map((group) => (
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
          ))
        )}
      </div>
    </aside>
  );
};
