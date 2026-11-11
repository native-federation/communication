import { resolve } from 'node:path';
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
      exclude: ['src/lib/**/*.spec.ts', 'src/**/*.contract.ts', 'src/lib/**/index.ts'],
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
          // The recipes import the package by name, as the docs show; they run against the build.
          alias: {
            '@softarc/native-federation-communication': resolve(
              __dirname,
              'test/.dist/fesm2022/@softarc/native-federation-communication.mjs'
            ),
          },
        },
      },
    ],
  },
});
