interface ImportMetaEnv {
  /** Override the API origin, e.g. a staging backend. */
  readonly VITE_API_URL?: string;
  /** "true" serves every request from the in-memory mock backend. */
  readonly VITE_USE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
