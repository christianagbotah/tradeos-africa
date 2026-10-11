/**
 * Ambient module declaration for the Tauri store plugin.
 *
 * The plugin is loaded lazily (dynamic import) only when a Tauri native
 * runtime is detected, so the browser bundle never pulls it in. TypeScript
 * needs a module declaration so the dynamic import compiles without the
 * package being installed in plain Vite dev mode.
 *
 * The shape mirrors the real @tauri-apps/plugin-store surface we use.
 */
declare module "@tauri-apps/plugin-store" {
  export interface TauriStoreLike {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    save(): Promise<void>;
  }
  export function load(path: string, opts?: unknown): Promise<TauriStoreLike>;
}
