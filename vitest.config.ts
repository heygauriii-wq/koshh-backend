import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['dotenv/config'],
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
