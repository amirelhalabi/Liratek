// __mocks__/electron.ts
export const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn(),
};

export const app = {
    getPath: jest.fn(() => '/tmp'),
    isPackaged: false,
};
