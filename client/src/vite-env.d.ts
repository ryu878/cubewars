/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CUBEWARS_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
