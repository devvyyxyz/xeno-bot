module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js']
  ,
  globalTeardown: '<rootDir>/tests/jest-teardown.js'
};

