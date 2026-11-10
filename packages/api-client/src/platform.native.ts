// React Native build of ./platform. There is no localStorage, so sessions start in memory; the
// app swaps in secure storage with configureApiClient() before it renders anything.
import type { KeyValueStorage } from './storage';

declare const process: { env: Record<string, string | undefined> };

export const API_URL: string | undefined = process.env.EXPO_PUBLIC_API_URL;

export const USE_MOCKS = process.env.EXPO_PUBLIC_USE_MOCKS === 'true';

const memory = new Map<string, string>();

export const defaultStorage: KeyValueStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
  },
};
