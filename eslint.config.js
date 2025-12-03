import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['public/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        requestAnimationFrame: 'readonly',
        performance: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        URLSearchParams: 'readonly',
        confirm: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        Worker: 'readonly',
        ImageData: 'readonly',
        Uint32Array: 'readonly',
        Uint8Array: 'readonly',
        Float32Array: 'readonly',
        Math: 'readonly',
        Infinity: 'readonly',
        // Web Worker globals
        self: 'readonly',
        postMessage: 'readonly',
        importScripts: 'readonly',
        // Node/CommonJS (for lib.js UMD)
        exports: 'readonly',
        // App globals (from lib.js)
        Lib: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'semi': ['error', 'always'],
    },
  },
  {
    ignores: ['node_modules/', 'test/'],
  },
];
