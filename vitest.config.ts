import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment for service-layer tests — no JSDOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Pool=threads is default; forks cost more startup on every shard.
    pool: 'threads',
  },
});
