import { normaliseMaterials } from './recipe';
import type { Material, RawMaterial } from './types';

// The list is about 500 KB, so it ships as its own file and is fetched the first time it's needed
// instead of sitting in the JavaScript bundle.
const MATERIALS_URL = new URL('./data/materials.json', import.meta.url).href;

let cache: Promise<Material[]> | null = null;

export function loadMaterials(): Promise<Material[]> {
  cache ??= fetch(MATERIALS_URL)
    .then((res) => {
      if (!res.ok) throw new Error('The materials list could not be loaded.');
      return res.json() as Promise<RawMaterial[]>;
    })
    .then(normaliseMaterials)
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}
