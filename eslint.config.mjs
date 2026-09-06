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
  {
    // Icon fonts are bundled per family. Importing from the package index makes
    // Metro pull every family's TTF — roughly 3.5 MB into an APK operators
    // download over plant signal — where the deep path pulls one 348 KB font.
    // components/icon.tsx owns that single import; everything else goes through
    // its Icon and ICON exports.
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    ignores: ['components/icon.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@expo/vector-icons',
          message: 'Import { Icon, ICON } from "@/components/icon" instead — the package index bundles every icon font.',
        }],
        patterns: [{
          group: ['@expo/vector-icons/*'],
          message: 'Only components/icon.tsx may import an icon family directly. Use { Icon, ICON } from "@/components/icon".',
        }],
      }],
    },
  },
];

export default config;
