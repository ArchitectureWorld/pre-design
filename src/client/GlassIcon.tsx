export function GlassIcon({ name }: { readonly name: string }) {
  const paths: Record<string, string> = {
    folder: 'M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0h18',
    image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-1 15 5-6 4 4 3-3 5 5M8 7h.01',
    web: 'M3 12h18M5 6h14M5 18h14M12 3c5 5 5 13 0 18-5-5-5-13 0-18Zm9 9a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    review: 'm12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
    text: 'M4 6V4h16v2M12 4v16M8 20h8',
    settings: 'M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10M7 4h4v4H7Zm6 6h4v4h-4ZM7 16h4v4H7Z',
    check: 'm5 12 4 4L19 6',
    plus: 'M12 5v14M5 12h14',
    close: 'm6 6 12 12M18 6 6 18',
    info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    link: 'm10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  }
  return <svg className="pre-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.info} /></svg>
}
