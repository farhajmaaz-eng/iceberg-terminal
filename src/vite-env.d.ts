/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_RPC_FLAVOUR?: string;
  readonly VITE_DEFAULT_RPC_URL?: string;
  readonly VITE_DEFAULT_MARKET_PROVIDER?: string;
  readonly VITE_FORCE_DEMO_MODE?: string;
  readonly VITE_TELEMETRY_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;

interface Window {
  __ICEBERG_DEBUG__?: boolean;
}