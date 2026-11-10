// Expo's web build resolves this file ahead of platform.ts. It reads the same EXPO_PUBLIC_
// settings as the native build; Vite never looks at .web.ts, so the browser apps are unaffected.
export * from './platform.native';
