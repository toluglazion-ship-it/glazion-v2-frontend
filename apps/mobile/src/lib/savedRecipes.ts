import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStoredUser } from '@glazion/api-client';
import type { RecipeDraft, SavedRecipe } from '@glazion/api-client/recipes';

// Recipes are kept on this phone until the backend can store them, one list per account.

const storageKey = () => `glazion_recipes_${getStoredUser()?.id ?? 'guest'}`;
const QUERY_KEY = ['saved-recipes'];
const NONE: SavedRecipe[] = [];

async function read(): Promise<SavedRecipe[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey());
    return raw ? (JSON.parse(raw) as SavedRecipe[]) : NONE;
  } catch {
    // Unreadable storage is treated as nothing saved.
    return NONE;
  }
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Saved recipes, most recently saved first, with the two ways to change them. */
export function useSavedRecipes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: read, staleTime: Infinity });
  const recipes = query.data ?? NONE;

  async function write(list: SavedRecipe[]) {
    queryClient.setQueryData(QUERY_KEY, list);
    await AsyncStorage.setItem(storageKey(), JSON.stringify(list));
  }

  return {
    recipes,
    /** Saves over the recipe with this id, or adds a new one when no id is given. */
    async save(draft: RecipeDraft, id?: string): Promise<SavedRecipe> {
      const recipe: SavedRecipe = { ...draft, name: draft.name.trim() || 'Untitled recipe', id: id ?? newId(), updatedAt: new Date().toISOString() };
      await write([recipe, ...recipes.filter((r) => r.id !== recipe.id)]);
      return recipe;
    },
    async remove(id: string) {
      await write(recipes.filter((r) => r.id !== id));
    },
  };
}
