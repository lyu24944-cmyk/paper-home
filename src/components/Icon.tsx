import type { ReactNode } from 'react'

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 11 9-8 9 8M5.5 9v12h13V9M10 21v-7h4v7" /><path d="M7 2v4" /></>,
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
    back: <path d="M20 12H5m5-5-5 5 5 5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    map: <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    book: <path d="M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1v15M5 8h4M5 11h4m6-3h4m-4 3h4" />,
    door: <><path d="M5 21V3h14v18M9 21V5l8-1v17M3 21h18" /><circle cx="14" cy="13" r=".6" /></>,
    frame: <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="m5 17 5-6 4 4 2-3 3 5" /><circle cx="16" cy="8" r="1.5" /></>,
    spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />,
    motion: <path d="M3 7h8a3 3 0 1 0-3-3M2 12h15a3 3 0 1 1-3 3M5 17h3M19 5l2-2" />,
    pencil: <path d="m4 15 11-11 5 5L9 20l-6 1zM13 6l5 5M4 15l5 5" />,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 1 1 8 0v4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />,
    up: <path d="m6 15 6-6 6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    play: <polygon points="7 5 19 12 7 19 7 5" />,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.5" /></>,
    link: <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.5-1.5" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></>,
    refresh: <path d="M20 11a8 8 0 0 0-14-4M4 4v5h5M4 13a8 8 0 0 0 14 4m2 3v-5h-5" />,
    copy: <><rect x="9" y="9" width="11" height="11" rx="1" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.home}
    </svg>
  )
}
