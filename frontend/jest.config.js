const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: __dirname });

// Modulos ES que Jest debe transformar (react-markdown y su arbol de dependencias).
const ESM_PACKAGES = [
  'react-markdown',
  'devlop',
  'hast-util-to-jsx-runtime',
  'hast-util-whitespace',
  'html-url-attributes',
  'estree-util-is-identifier-name',
  'unist-util-[a-z-]+',
  'unified',
  'bail',
  'is-plain-obj',
  'trough',
  'vfile',
  'vfile-message',
  'remark-[a-z-]+',
  'mdast-util-[a-z-]+',
  'micromark[a-z-]*',
  'decode-named-character-reference',
  'character-entities',
  'property-information',
  'space-separated-tokens',
  'comma-separated-tokens',
  'trim-lines',
  'ccount',
  'markdown-table',
  'zwitch',
  'longest-streak',
  'stringify-entities',
  'character-entities-html4',
  'character-entities-legacy',
  'character-reference-invalid',
  'is-decimal',
  'is-hexadecimal',
  'is-alphabetical',
  'is-alphanumerical',
  'parse-entities',
  'inline-style-parser',
  'style-to-object',
  'style-to-js',
].join('|');

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.spec.tsx'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.spec.{ts,tsx}', '!src/test-utils.tsx', '!src/app/**'],
};

module.exports = async () => {
  const resolved = await createJestConfig(config)();
  return {
    ...resolved,
    transformIgnorePatterns: [
      `/node_modules/(?!(${ESM_PACKAGES})/)`,
      '^.+\\.module\\.(css|sass|scss)$',
    ],
  };
};
