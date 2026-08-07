import "@testing-library/jest-dom/vitest";

// Ensure globalThis.window is available for React 19 scheduler (setImmediate callbacks)
// without this, the scheduler's performWorkUntilDeadline throws "window is not defined"
(globalThis as Window & typeof globalThis).window = window;

// Polyfill localStorage for tests that don't use jsdom's native implementation
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});
