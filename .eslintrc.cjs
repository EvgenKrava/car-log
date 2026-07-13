module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, es2022: true, browser: true },
  ignorePatterns: ['dist', 'cdk.out', 'node_modules', '*.cjs'],
  rules: { '@typescript-eslint/no-explicit-any': 'error' },
};