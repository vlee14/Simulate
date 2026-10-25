import { useEffect, useState } from 'react';

export type AppearanceChoice = 'system' | 'light' | 'dark';
export type ResolvedAppearance = 'light' | 'dark';

const STORAGE_KEY = 'simulate-appearance';

export const canvasTone = {
  light: {
    dot: 'rgba(60, 60, 67, 0.22)',
    mask: 'rgba(251, 251, 253, 0.72)',
    blue: '#0071e3',
    edge: '#c7c7cc',
  },
  dark: {
    dot: 'rgba(235, 235, 245, 0.2)',
    mask: 'rgba(28, 28, 30, 0.72)',
    blue: '#0a84ff',
    edge: '#636366',
  },
} as const;

const readChoice = (): AppearanceChoice => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return 'system';
};

export const useAppearance = () => {
  const [choice, setChoice] = useState<AppearanceChoice>(readChoice);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedAppearance = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', choice);
    root.style.colorScheme = choice === 'system' ? 'light dark' : choice;

    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* Ignore persistence failures and keep the in-memory choice. */
    }

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#1c1c1e' : '#f5f5f7');
  }, [choice, resolved]);

  return { choice, setChoice, resolved, tone: canvasTone[resolved] };
};
