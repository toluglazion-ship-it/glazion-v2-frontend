/// <reference path="./env.d.ts" />
// What differs between the web and the mobile build of the client. Bundlers for the browser
// pick this file; React Native's picks platform.native.ts.
import type { KeyValueStorage } from './storage';

export const API_URL: string | undefined = import.meta.env.VITE_API_URL;

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

export const defaultStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};
