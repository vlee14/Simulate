import React from 'react';

type IconProps = { className?: string };

export const AppMark: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path
      d="M2.2 11.5c1.6-.6 2.5-4.2 4.3-4.2 1.7 0 2.1 5.2 4 5.2 1.6 0 2.4-2.6 5.3-3.6"
      stroke="white"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SidebarIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6.1 2.4v11.2" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const GainIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const SearchIcon: React.FC = () => (
  <svg className="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="6.2" cy="6.2" r="4" stroke="currentColor" strokeWidth="1.4" />
    <path d="M9.2 9.2L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const SystemIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="2.4" width="12" height="8.2" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6 13.6h4M8 10.6v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const SunIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export const MoonIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M9.4 2.1a5 5 0 1 0 4.5 7.1A4.1 4.1 0 0 1 9.4 2.1z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

export const SignalIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 8h3l1.6-4 2.6 8 1.6-4h4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
