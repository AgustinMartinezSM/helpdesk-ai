const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);
swcJestConfig.swcrc = false;

// Integration suites hit the real helpdesk_tickets_test database on 5433.
// Run through `nx run @helpdesk-ai/tickets-service:test-integration` with the
// compose postgres service up; suites run serially to avoid data races.
module.exports = {
  displayName: '@helpdesk-ai/tickets-service (integration)',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage-integration',
  // Overrides the preset's testMatch: integration suites only.
  testMatch: ['**/*.int.spec.ts'],
};
