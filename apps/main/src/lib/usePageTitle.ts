import { useEffect } from 'react';

/** The browser tab's title for this page: "Find tiles · Glazion" (or just "Ask Glazion", which already says it). */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = !title ? 'Glazion' : title.includes('Glazion') ? title : `${title} · Glazion`;
  }, [title]);
}
