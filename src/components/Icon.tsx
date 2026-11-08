import React from 'react';

export type IconName =
  | 'play'
  | 'pause'
  | 'reset'
  | 'undo'
  | 'redo'
  | 'save'
  | 'fit'
  | 'file'
  | 'folder'
  | 'folderOpen'
  | 'blocks'
  | 'inspect'
  | 'trash'
  | 'close'
  | 'plus'
  | 'expand'
  | 'chevronUp'
  | 'chevronDown'
  | 'chevronRight'
  | 'home'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'copy'
  | 'download'
  | 'upload'
  | 'refresh';

const paths: Record<IconName, React.ReactNode> = {
  play: <path d="M9 6.5v11l9-5.5z" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="6" width="3.5" height="12" rx="0.8" stroke="none" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="0.8" stroke="none" />
    </>
  ),
  reset: (
    <>
      <path d="M6.5 12a5.5 5.5 0 1 0 1.6-3.9" fill="none" />
      <path d="M6 5.5v4h4" fill="none" />
    </>
  ),
  undo: (
    <>
      <path d="M8 12h7.5a3.5 3.5 0 0 0 0-7H14" fill="none" />
      <path d="M8 12 5 9l3-3" fill="none" />
    </>
  ),
  redo: (
    <>
      <path d="M16 12H8.5a3.5 3.5 0 0 1 0-7H10" fill="none" />
      <path d="M16 12l3-3-3-3" fill="none" />
    </>
  ),
  save: (
    <>
      <path d="M6 6.5h9.5L18 9v8.5H6z" fill="none" />
      <path d="M9 6.5v4h6v-4" fill="none" />
      <path d="M9 18v-4.5h6V18" fill="none" />
    </>
  ),
  fit: (
    <>
      <path d="M7 9V7h2M15 7h2v2M17 15v2h-2M9 17H7v-2" fill="none" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" fill="none" />
    </>
  ),
  file: (
    <>
      <path d="M8 5.5h5.5L17 9v9.5H8z" fill="none" />
      <path d="M13.5 5.5V9H17" fill="none" />
    </>
  ),
  folder: <path d="M5.5 8.5h4l1.5 1.5H18.5v8H5.5z" fill="none" />,
  folderOpen: (
    <>
      <path d="M5.5 10h4l1.2 1.2H14" fill="none" />
      <path d="M5.5 10v7.5h13L17 12H8.5" fill="none" />
    </>
  ),
  blocks: (
    <>
      <rect x="5.5" y="5.5" width="5.5" height="5.5" rx="1" fill="none" />
      <rect x="13" y="5.5" width="5.5" height="5.5" rx="1" fill="none" />
      <rect x="5.5" y="13" width="5.5" height="5.5" rx="1" fill="none" />
      <rect x="13" y="13" width="5.5" height="5.5" rx="1" fill="none" />
    </>
  ),
  inspect: (
    <>
      <circle cx="11" cy="11" r="4.5" fill="none" />
      <path d="M14.5 14.5 18 18" fill="none" />
    </>
  ),
  trash: (
    <>
      <path d="M8 8.5h8l-.7 10H8.7z" fill="none" />
      <path d="M7 8.5h10M10 8.5V7h4v1.5M11 11.5v4M13 11.5v4" fill="none" />
    </>
  ),
  close: <path d="M7 7l10 10M17 7 7 17" fill="none" />,
  plus: <path d="M12 6.5v11M6.5 12h11" fill="none" />,
  expand: (
    <>
      <path d="M9 7H7v2M15 7h2v2M17 15v2h-2M9 17H7v-2" fill="none" />
    </>
  ),
  chevronUp: <path d="M7 14l5-5 5 5" fill="none" />,
  chevronDown: <path d="M7 10l5 5 5-5" fill="none" />,
  chevronRight: <path d="M10 7l5 5-5 5" fill="none" />,
  home: (
    <>
      <path d="M5.5 12 12 6l6.5 6" fill="none" />
      <path d="M8 11.5V18h8v-6.5" fill="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.2" fill="none" />
      <path d="M12 5.5v1.8M12 16.7v1.8M5.5 12h1.8M16.7 12h1.8M7.2 7.2l1.3 1.3M15.5 15.5l1.3 1.3M16.8 7.2l-1.3 1.3M8.5 15.5l-1.3 1.3" fill="none" />
    </>
  ),
  moon: <path d="M15.5 13.5A5.5 5.5 0 0 1 10 6a5.5 5.5 0 1 0 5.5 7.5z" fill="none" />,
  monitor: (
    <>
      <rect x="5.5" y="6.5" width="13" height="9" rx="1.2" fill="none" />
      <path d="M9.5 18.5h5M12 15.5v3" fill="none" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="9" height="9" rx="1.2" fill="none" />
      <path d="M6.5 15.5V6.5h9" fill="none" />
    </>
  ),
  download: (
    <>
      <path d="M12 6.5v9" fill="none" />
      <path d="M8.5 12.5 12 16l3.5-3.5" fill="none" />
      <path d="M6.5 18.5h11" fill="none" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16.5v-9" fill="none" />
      <path d="M8.5 10.5 12 7l3.5 3.5" fill="none" />
      <path d="M6.5 18.5h11" fill="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M6.5 12a5.5 5.5 0 1 0 1.6-3.9" fill="none" />
      <path d="M6 5.5v4h4" fill="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `ui-icon ${className}` : 'ui-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[name]}
      </g>
    </svg>
  );
}

/** Icon + label row for toolbar / action buttons. */
export function BtnIcon({
  icon,
  children,
}: {
  icon: IconName;
  children?: React.ReactNode;
}) {
  return (
    <span className="btn-with-icon">
      <Icon name={icon} />
      {children != null && children !== '' ? <span className="btn-label">{children}</span> : null}
    </span>
  );
}
