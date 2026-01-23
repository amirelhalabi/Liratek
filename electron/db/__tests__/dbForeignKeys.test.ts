import { getDatabase } from "../index";
import Database, { resetAllMocks } from "../../../__mocks__/better-sqlite3";

jest.mock("better-sqlite3");
jest.mock("electron", () => ({
  app: {
    getPath: jest.fn(() => "/tmp"),
  },
}));

describe("DB foreign key enforcement", () => {
  beforeEach(() => {
    resetAllMocks();
    // Ensure each created DB instance has a pragma mock.
    (Database as unknown as jest.Mock).mockImplementation(() => ({
      prepare: jest.fn(),
      exec: jest.fn(),
      close: jest.fn(),
      pragma: jest.fn(() => []),
    }));
  });

  it("enables foreign key enforcement on database init", () => {
    const db = getDatabase() as any;

    expect(db.pragma).toHaveBeenCalledWith("journal_mode = WAL");
    expect(db.pragma).toHaveBeenCalledWith("foreign_keys = ON");
    expect(db.pragma).toHaveBeenCalledWith("foreign_key_check");
  });
});
