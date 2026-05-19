// ESLint 9 flat config. tsc already enforces type safety; this layer covers
// stylistic / dead-code checks tsc doesn't catch (unused vars, hook rules).
import tseslintPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      'scripts/**',
      'vite.config.ts',
      '*.config.js',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslintPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
]
