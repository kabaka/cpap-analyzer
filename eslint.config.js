import eslint from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore everything under scripts/ EXCEPT the release tooling: those .mjs/.ts
  // files are tracked production code (run by CI) and must be linted. Note the
  // file-level glob `scripts/**/*` (not the directory `scripts/**`): ESLint prunes
  // an ignored *directory* before a later negation can re-include its children, so
  // ignoring at the file level — then negating `scripts/release` and its tree —
  // is what actually un-ignores the release files while keeping siblings ignored.
  {
    ignores: [
      'dist/',
      'coverage/',
      'playwright-report/',
      'scripts/**/*',
      '!scripts/release',
      '!scripts/release/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-console': 'warn',
    },
  },
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  // Release tooling runs under Node (process, node:* imports, console output for
  // CLI feedback). Give those files Node globals and allow console use.
  {
    files: ['scripts/release/**/*.{mjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  // The fixture generator is a CLI script whose console output is legitimate
  // progress feedback (same reasoning as the release-tooling override). Allow
  // console use there.
  {
    files: ['tests/fixtures/generators/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
