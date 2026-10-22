// The engineering standard's lint layer (D:/Meaningful/AI/agent-skills/rules/engineering-principles.md): the size
// rule (principle 5) and the import boundaries (principles 2 and 3), as flat-config blocks to spread into the
// project's eslint.config.js after the stack's own config. Laid down by the engineering-audit skill's apply script;
// edit the folder globs only when the project records different layer names in its PROJECT.md.
const ENGINE = ['src/engine/**', 'src/lib/**', 'lib/**'];
const ADAPTERS = ['src/adapters/**', 'src/storage/**', 'src/cloud/**', 'adapters/**'];
const UI = ['src/ui/**', 'src/screens/**', 'src/components/**'];
const UPPER_OF_ENGINE = ['**/adapters/**', '**/storage/**', '**/cloud/**', '**/ui/**', '**/screens/**', '**/components/**', '**/app/**'];
const UPPER_OF_ADAPTERS = ['**/ui/**', '**/screens/**', '**/components/**', '**/app/**'];
const FRAMEWORK_AND_IO = ['react', 'react-dom', 'react-native', 'react/*', 'react-native/*', 'expo', 'expo-*', '@expo/*', '@react-navigation/*',
  'fs', 'fs/*', 'node:fs', 'node:fs/*', 'http', 'https', 'node:http', 'node:https', 'child_process', 'node:child_process', 'path', 'node:path', 'os', 'node:os'];

export default [
  {
    // Principle 5: a file over 500 lines fails lint; the audit warns from 300. An existing offender carries a one-line
    // `/* eslint-disable max-lines */` with the DECISIONS.md entry that names the split.
    rules: { 'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }] },
  },
  {
    // Principle 2: the engine is pure. No framework, no I/O, no clock or storage globals, nothing from the layers above.
    files: ENGINE,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: FRAMEWORK_AND_IO, message: 'engine/ is pure: no framework or I/O imports; pass data in as arguments' },
          { group: UPPER_OF_ENGINE, message: 'engine/ imports nothing above it (adapters, ui, app)' },
        ],
      }],
      'no-restricted-globals': ['error', 'document', 'window', 'navigator', 'localStorage', 'sessionStorage', 'fetch'],
    },
  },
  {
    // Principle 3: adapters use the engine, never the UI or the app shell.
    files: ADAPTERS,
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: UPPER_OF_ADAPTERS, message: 'adapters/ never import the UI or the app shell' }] }] },
  },
  {
    // Principle 3: the UI uses engine and adapters, never the app shell.
    files: UI,
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/app/**'], message: 'ui/ never imports the app shell' }] }] },
  },
];
