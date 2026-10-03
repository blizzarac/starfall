import { defineConfig } from 'vitest/config';

// The balance simulation is slow, so it runs on demand (`npm run balance`), not with the tests.
export default defineConfig({
  test: { include: ['**/*.sim.ts'], testTimeout: 3_600_000 },
});
