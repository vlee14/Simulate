import { useEffect, useState } from 'react';

/** Editor switches to drawers below this width. Match the breakpoint in styles.css. */
export const COMPACT_LAYOUT = '(max-width: 1040px)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const CATEGORY_COLOR: Record<string, string> = {
  Sources: '#e7a23a',
  Math: '#5ec8ff',
  Continuous: '#3dbe86',
  Discrete: '#d2a8ff',
  Nonlinear: '#ff8a5b',
  Plants: '#ffb085',
  Sinks: '#ff6b8a',
  Annotation: '#8b97a8',
};

export function formatTime(seconds: number): string {
  const sign = seconds < 0 ? '−' : '';
  const value = Math.abs(seconds);
  const minutes = Math.floor(value / 60);
  const whole = Math.floor(value % 60);
  const millis = Math.floor((value % 1) * 1000);
  return `${sign}${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function downloadText(filename: string, contents: string, type = 'text/plain'): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
