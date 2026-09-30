const transform = {
  '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
      setupFiles: ['<rootDir>/test/integration/set-env.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/integration/set-timeout.ts'],
      transform,
    },
  ],
  collectCoverageFrom: [
    'src/**/domain/**/*.ts',
    'src/**/application/**/*.ts',
    '!src/**/*.spec.ts',
  ],
  coverageThreshold: {
    global: { statements: 80, functions: 80, lines: 80, branches: 70 },
  },
};
