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
      // Off in favour of the typescript-eslint version from eslint-config-expo:
      // the base rule reads parameter names inside type annotations as real
      // bindings and reports them as unused.
      'no-unused-vars': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];

export default config;
