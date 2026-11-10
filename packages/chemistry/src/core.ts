// The calculation without the bundled materials list, for code that brings its own materials
// (the api-client's fake backend). The apps don't use this package: the backend does the maths.
export * from './types';
export { OXIDES, OXIDE_INDEX } from './oxides';
export { computeChemistry } from './chemistry';
export * from './recipe';
export * from './limits';
