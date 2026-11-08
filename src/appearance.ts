export type Appearance = 'system' | 'light' | 'dark';

const KEY = 'simulate-appearance';

export function getAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function resolvedTheme(choice: Appearance = getAppearance()): 'light' | 'dark' {
  if (choice === 'light' || choice === 'dark') return choice;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function applyAppearance(choice: Appearance = getAppearance()): 'light' | 'dark' {
  const theme = resolvedTheme(choice);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1c1c1e' : '#f5f5f7');
  }
  return theme;
}

export function setAppearance(choice: Appearance): 'light' | 'dark' {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* ignore */
  }
  return applyAppearance(choice);
}

export function cycleAppearance(current: Appearance = getAppearance()): Appearance {
  const next: Appearance = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
  setAppearance(next);
  return next;
}
