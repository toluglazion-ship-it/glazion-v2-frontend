import type { RecipeDto } from '@glazion/types';

/** Coded recipes first, in code order, so the code written on a tile is easy to find. */
export function sortRecipes(recipes: RecipeDto[]): RecipeDto[] {
  return [...recipes].sort((a, b) => {
    if (a.code && b.code) return a.code.localeCompare(b.code, undefined, { numeric: true });
    if (a.code || b.code) return a.code ? -1 : 1;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}
