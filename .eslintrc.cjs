module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:jsdoc/recommended',
    'plugin:unicorn/recommended',
    'plugin:prettier/recommended',
  ],
  plugins: ['prettier'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-var': 'warn',
    'prefer-const': 'warn',
    eqeqeq: 'warn',
    'no-empty': 'warn',
    'no-empty-pattern': 'warn',
    'no-console': 'warn',
    'no-unused-vars': 'warn',
    'no-else-return': 'warn',
    'no-continue': 'warn',

    'import/extensions': ['error', 'ignorePackages'],

    'prettier/prettier': 'warn',

    'jsdoc/tag-lines': ['warn', 'any', { startLines: 1 }],

    'unicorn/no-process-exit': 'off',
    'unicorn/no-array-reduce': 'off',
  },
};
