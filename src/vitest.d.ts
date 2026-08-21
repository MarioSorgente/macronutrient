declare module "vitest" {
  export const beforeEach: (callback: () => void) => void;
  export const describe: (name: string, callback: () => void) => void;
  export const expect: any;
  export const it: (name: string, callback: () => unknown) => void;
  export const vi: any;
}
