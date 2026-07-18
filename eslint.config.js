import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import pluginTs from '@typescript-eslint/eslint-plugin';
import parserTs from '@typescript-eslint/parser';
import parserVue from 'vue-eslint-parser';
import prettierSkipFormatting from '@vue/eslint-config-prettier/skip-formatting';

export default [
  {
    /**
     * Ignore the following files and directories.
     */
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.quasar/**',
      '**/cdk.out/**',
      '**/cdk-out-synth/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/src-capacitor/**',
    ],
  },

  // Base JavaScript recommended rules
  js.configs.recommended,

  // General TypeScript configuration for CDK package
  {
    files: ['packages/cdk/**/*.ts'],
    languageOptions: {
      parser: parserTs,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        process: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // Vue essential rules for Vue files
  {
    files: ['apps/vela/**/*.vue'],
    languageOptions: {
      parser: parserVue,
      parserOptions: {
        parser: parserTs,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        ga: 'readonly',
        cordova: 'readonly',
        Capacitor: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
        NodeJS: 'readonly',
        RequestInfo: 'readonly',
        RequestInit: 'readonly',
        ResponseInit: 'readonly',
      },
    },
    plugins: {
      vue: pluginVue,
      '@typescript-eslint': pluginTs,
    },
    rules: {
      ...pluginVue.configs['flat/essential'].rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // TypeScript files in Vue app
  {
    files: ['apps/vela/**/*.ts'],
    languageOptions: {
      parser: parserTs,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        ga: 'readonly',
        cordova: 'readonly',
        Capacitor: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
        NodeJS: 'readonly',
        RequestInfo: 'readonly',
        RequestInit: 'readonly',
        ResponseInit: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // Vue files in vela-mobile package
  {
    files: ['apps/vela-mobile/**/*.vue'],
    languageOptions: {
      parser: parserVue,
      parserOptions: {
        parser: parserTs,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        Capacitor: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    plugins: {
      vue: pluginVue,
      '@typescript-eslint': pluginTs,
    },
    rules: {
      ...pluginVue.configs['flat/essential'].rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // TypeScript files in vela-mobile package
  {
    files: ['apps/vela-mobile/**/*.ts'],
    languageOptions: {
      parser: parserTs,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        Capacitor: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // JavaScript files in Vue app
  {
    files: ['apps/vela/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        ga: 'readonly',
        cordova: 'readonly',
        Capacitor: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    rules: {
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // Service worker specific configuration
  {
    files: ['**/src-pwa/custom-service-worker.ts'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },

  // TypeScript files in common package
  {
    files: ['packages/common/**/*.ts'],
    languageOptions: {
      parser: parserTs,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        process: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // TypeScript files in vela-api package
  {
    files: ['apps/vela-api/**/*.ts'],
    languageOptions: {
      parser: parserTs,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        process: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // JavaScript files in vela-api package
  {
    files: ['apps/vela-api/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        process: 'readonly',
      },
    },
    rules: {
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // JavaScript files in vela-mobile package
  {
    files: ['apps/vela-mobile/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        process: 'readonly',
      },
    },
    rules: {
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // Vue files in vela-ext package
  {
    files: ['apps/vela-ext/**/*.vue'],
    languageOptions: {
      parser: parserVue,
      parserOptions: {
        parser: parserTs,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    plugins: {
      vue: pluginVue,
      '@typescript-eslint': pluginTs,
    },
    rules: {
      ...pluginVue.configs['flat/essential'].rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // TypeScript files in vela-ext package
  {
    files: ['apps/vela-ext/**/*.ts'],
    languageOptions: {
      parser: parserTs,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        process: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
        defineBackground: 'readonly',
        defineContentScript: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-promise-reject-errors': 'off',
      'no-debugger': 'error',
    },
  },

  // Prettier formatting
  prettierSkipFormatting,
];
