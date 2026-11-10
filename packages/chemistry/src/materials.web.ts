// Expo's web build resolves this file ahead of materials.ts and bundles the list, like native.
// Vite never looks at .web.ts, so the browser apps keep fetching it as a separate file.
export * from './materials.native';
