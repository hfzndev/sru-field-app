import expo from 'eslint-config-expo/flat.js';

/**
 * Flat config. Kept quiet enough to stay useful: a lint step that cries wolf
 * gets skipped, and then it catches nothing.
 */
const config = [
  { ignores: ['node_modules/**', '.expo/**', 'dist/**', 'android/**', 'ios/**'] },
  ...expo,
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];

export default config;
