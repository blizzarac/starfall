import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site at /<repo-name>/.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/starfall/' : '/',
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
