import { getStoredUser } from '@glazion/api-client';
import { toDraftRow, type DraftRow, type Row } from '../components/recipe/RecipeRows';

// The calculator's recipe in progress, kept in this browser per account so leaving the page (to find
// tiles with its UMF, say) and coming back doesn't lose it. Rows keep half-typed materials as they are.

export interface UmfDraft {
  name: string;
  cone: string;
  base: DraftRow[];
  colourants: DraftRow[];
  /** The saved recipe it came from, so saving again still overwrites that one. */
  savedId: string | null;
}

const key = () => `glazion_umf_draft_${getStoredUser()?.id ?? 'guest'}`;

const isEmpty = (row: DraftRow) => !row.material && !row.amount;

export const umfDraft = {
  read(): UmfDraft | null {
    try {
      const raw = localStorage.getItem(key());
      return raw ? (JSON.parse(raw) as UmfDraft) : null;
    } catch {
      return null;
    }
  },
  write(draft: { name: string; cone: string; base: Row[]; colourants: Row[]; savedId: string | null }) {
    const stored: UmfDraft = { ...draft, base: draft.base.map(toDraftRow), colourants: draft.colourants.map(toDraftRow) };
    const blank = !stored.name.trim() && !stored.savedId && stored.base.every(isEmpty) && stored.colourants.every(isEmpty);
    try {
      if (blank) localStorage.removeItem(key());
      else localStorage.setItem(key(), JSON.stringify(stored));
    } catch {
      // Full or blocked storage: the recipe still holds while the page is open.
    }
  },
};
