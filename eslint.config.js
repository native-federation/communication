const typescript = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const globals = require('globals');
const prettier = require('eslint-plugin-prettier');

// The barrel defines the published API. Internal code imports concrete modules so the
// dependency graph stays visible and free of accidental cycles.
const ENTRY_BARREL = {
  group: ['**/index', '**/index.ts'],
  message: 'The barrel (index.ts) is for package consumers only. Import the concrete module instead.',
};

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'test/.dist/**', '**/*.js', '**/*.d.ts', '**/*.spec.ts'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      prettier: prettier,
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      'no-restricted-imports': ['error', { patterns: [ENTRY_BARREL] }],

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-unused-expressions': 'error',
      'no-duplicate-imports': 'error',
      'prefer-const': 'error',

      complexity: ['error', 5],
      'max-depth': ['error', 2],
      'max-params': ['error', 3],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
];
