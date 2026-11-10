import { useSyncExternalStore } from 'react';
import { getStoredUser } from '@glazion/api-client';
import type { RecipeDraft, SavedRecipe } from '@glazion/api-client/recipes';

// Recipes are kept in this browser until the backend can store them, one list per account.

const key = () => `glazion_recipes_${getStoredUser()?.id ?? 'guest'}`;

const NONE: SavedRecipe[] = [];
let cache: { key: string; list: SavedRecipe[] } | null = null;
const listeners = new Set<() => void>();

function read(): SavedRecipe[] {
  const current = key();
  if (cache?.key === current) return cache.list;
  let list = NONE;
  try {
    const raw = localStorage.getItem(current);
    if (raw) list = JSON.parse(raw) as SavedRecipe[];
  } catch {
    // Unreadable storage is treated as nothing saved.
  }
  cache = { key: current, list };
  return list;
}

/** False when the browser won't store it (blocked or full storage); nothing changes then. */
function write(list: SavedRecipe[]): boolean {
  const current = key();
  try {
    localStorage.setItem(current, JSON.stringify(list));
  } catch {
    return false;
  }
  cache = { key: current, list };
  listeners.forEach((listener) => listener());
  return true;
}

export const STORAGE_BLOCKED = 'This browser isn’t letting Glazion store recipes. Allow site data for Glazion, or export the recipe instead.';

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Saved recipes, most recently saved first. */
export function useSavedRecipes(): SavedRecipe[] {
  return useSyncExternalStore(subscribe, read);
}

export const savedRecipes = {
  /** Saves over the recipe with this id, or adds a new one when no id is given. Null if it couldn't be stored. */
  save(draft: RecipeDraft, id?: string): SavedRecipe | null {
    const recipe: SavedRecipe = { ...draft, name: draft.name.trim() || 'Untitled recipe', id: id ?? crypto.randomUUID(), updatedAt: new Date().toISOString() };
    return write([recipe, ...read().filter((r) => r.id !== recipe.id)]) ? recipe : null;
  },
  /** Returns where it was in the list, so it can be put back; -1 if it couldn't be removed. */
  remove(id: string): number {
    const at = read().findIndex((r) => r.id === id);
    return write(read().filter((r) => r.id !== id)) ? at : -1;
  },
  /** Puts a deleted recipe back where it was. */
  restore(recipe: SavedRecipe, at: number): boolean {
    const list = read().filter((r) => r.id !== recipe.id);
    return write([...list.slice(0, at), recipe, ...list.slice(at)]);
  },
};

export function download(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
