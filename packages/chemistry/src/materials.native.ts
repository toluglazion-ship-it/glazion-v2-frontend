// React Native build of ./materials: the list is bundled with the app instead of fetched.
import { normaliseMaterials } from './recipe';
import type { Material, RawMaterial } from './types';

declare const require: (path: string) => unknown;

let cache: Promise<Material[]> | null = null;

export function loadMaterials(): Promise<Material[]> {
  // Read lazily so the 500 KB list is only parsed when a recipe screen needs it.
  cache ??= Promise.resolve().then(() => normaliseMaterials(require('./data/materials.json') as RawMaterial[]));
  return cache;
}
