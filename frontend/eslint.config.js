import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['build/**', 'public/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // JSX references are invisible to core no-unused-vars without the React plugin,
      // so only flag unused plain variables, not imports used as components.
      'no-unused-vars': ['warn', { varsIgnorePattern: '^([A-Z_]|motion$)', args: 'after-used', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
];
