declare module '@tauri-apps/api/fs' {
  export type FsOptions = { dir?: any };
  export function readFile(path: string, options?: FsOptions): Promise<Uint8Array>;
  export function readTextFile(path: string, options?: FsOptions): Promise<string>;
  export function writeFile(options: { path: string; contents: string | Uint8Array }, fsOptions?: FsOptions): Promise<void>;
  export function removeFile(path: string, options?: FsOptions): Promise<void>;
  export enum BaseDirectory {
    Audio,
    Cache,
    Config,
    Data,
    Document,
    Download,
    Executable,
    Font,
    Home,
    Log,
    Picture,
    Public,
    Resource,
    Template,
    Video,
    App,
    AppConfig,
    AppData,
    AppLocalData,
    Desktop
  }
}
