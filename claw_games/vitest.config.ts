import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@server': path.resolve(__dirname, 'src/server'),
      '@client': path.resolve(__dirname, 'src/client'),
      '@engine': path.resolve(__dirname, 'src/engine'),
      '@games': path.resolve(__dirname, 'src/games'),
      '@ratings': path.resolve(__dirname, 'src/ratings'),
      '@matchmaking': path.resolve(__dirname, 'src/matchmaking'),
    },
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    globals: true,
    testTimeout: 10_000,
  },
});
