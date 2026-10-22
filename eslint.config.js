// ESLint for the kit: a TypeScript library on Node, plus the engineering standard's boundaries (eslint.boundaries.mjs).
// Scripts (scripts/*.mjs) are plain JavaScript and get the recommended rules with the Node globals.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import boundaries from './eslint.boundaries.mjs';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  ...boundaries,
];
