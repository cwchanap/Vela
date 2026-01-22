/* eslint-disable */
declare module 'pg' {
  export interface Client {
    connect(): Promise<void> | void;
    query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] } | any>;
    end(): Promise<void> | void;
  }
}

declare module 'vitest/config' {
  export function defineConfig(config: any): any;
}
