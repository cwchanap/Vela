// Type declarations for WXT globals
declare global {
  function defineBackground(_callback: () => void): void;
  function defineContentScript(_config: { matches: string[]; main(): void }): void;
}

export {};
