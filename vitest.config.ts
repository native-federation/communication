import { defineConfig } from 'vitest/config';
import { version } from './package.json';

export default defineConfig({
  define: { __NF_COMMUNICATION_VERSION__: JSON.stringify(version) },
  test: {
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['html', 'text'],
      reportsDirectory: 'coverage',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.spec.ts', 'src/lib/index.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'dist',
          include: ['test/**/*.spec.ts'],
          environment: 'jsdom',
          globalSetup: ['test/global-setup.ts'],
        },
      },
    ],
  },
});
