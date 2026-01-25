import { jest } from '@jest/globals';
import { mockDatabase } from './__mocks__/better-sqlite3';

// Provide a global hook consumed by @liratek/core db/connection
// so repositories/services can run in Jest without initializing a real DB.
(globalThis as any).__LIRATEK_TEST_DB__ = mockDatabase;

// Silence noisy logs from services; tests should assert return values.
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
