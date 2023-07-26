module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
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
    sourceType: 'module',
  },
  rules: {
    'no-alert': 'warn',
    'no-console': 'warn',
    'no-continue': 'warn',
    'no-debugger': 'warn',
    'no-else-return': 'warn',
    'no-empty-pattern': 'warn',
    'no-warning-comments': 'warn',
    'no-empty': 'warn',
    'no-unreachable': 'warn',
    'no-unused-vars': 'warn',
    'no-var': 'warn',
    'prefer-const': 'warn',
    'no-magic-numbers': ['warn', { ignore: [0] }],
    eqeqeq: 'warn',
    'no-confusing-arrow': 'warn',

    'import/extensions': ['error', 'ignorePackages'],

    'prettier/prettier': 'warn',

    'jsdoc/tag-lines': ['warn', 'any', { startLines: 1 }],

    'unicorn/no-process-exit': 'off', // This is a CLI app.
    'unicorn/no-array-reduce': 'off',
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/custom-error-definition': 'error',
    'unicorn/no-unsafe-regex': 'error',
    'unicorn/no-unused-properties': 'warn',
  },
  overrides: [
    {
      files: ['**/*.test.js'],
      env: {
        jest: true,
      },
    },
  ],
};
