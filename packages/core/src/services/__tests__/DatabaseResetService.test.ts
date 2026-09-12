/**
 * DatabaseResetService (LIRA-165 — Settings › Reset Data).
 *
 * Unit-tested against a MOCKED repository (rule 13 — services are testable
 * without a DB). The one invariant that matters here: the confirmation
 * phrase is re-checked server-side, defence-in-depth against the UI check
 * being bypassed. A wrong/empty phrase must be rejected WITHOUT the
 * repository ever being touched — a repo call on a rejected confirmation
 * would mean the guard is decorative, not load-bearing.
 */

import { DatabaseResetService } from "../DatabaseResetService.js";
import type { DatabaseResetRepository } from "../../repositories/DatabaseResetRepository.js";
import { DATABASE_RESET_CONFIRMATION_PHRASE } from "../../constants/resetTables.js";
import type { DatabaseResetResult } from "../../constants/resetTables.js";

function makeMockRepo() {
  return {
    previewCounts: jest.fn(),
    resetTenantData: jest.fn(),
  } as unknown as jest.Mocked<DatabaseResetRepository>;
}

describe("DatabaseResetService.reset", () => {
  it("rejects an empty confirmation phrase without calling the repository", () => {
    const repo = makeMockRepo();
    const service = new DatabaseResetService(repo);

    const result = service.reset({ confirmation: "" });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.data).toBeUndefined();
    expect(repo.resetTenantData).not.toHaveBeenCalled();
  });

  it("rejects a wrong confirmation phrase without calling the repository", () => {
    const repo = makeMockRepo();
    const service = new DatabaseResetService(repo);

    const result = service.reset({ confirmation: "reset all data" }); // wrong case

    expect(result.success).toBe(false);
    expect(result.error).toContain(DATABASE_RESET_CONFIRMATION_PHRASE);
    expect(repo.resetTenantData).not.toHaveBeenCalled();
  });

  it("calls the repository exactly once and returns success when the phrase matches exactly", () => {
    const repo = makeMockRepo();
    const fakeResult: DatabaseResetResult = {
      deletedRows: { sales: 3 },
      totalDeleted: 3,
    };
    (repo.resetTenantData as jest.Mock).mockReturnValue(fakeResult);
    const service = new DatabaseResetService(repo);

    const result = service.reset({
      confirmation: DATABASE_RESET_CONFIRMATION_PHRASE,
    });

    expect(repo.resetTenantData).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.data?.totalDeleted).toBe(3);
    expect(result.data?.deletedRows).toEqual({ sales: 3 });
  });

  it("passes backupPath straight through into the result untouched", () => {
    const repo = makeMockRepo();
    (repo.resetTenantData as jest.Mock).mockReturnValue({
      deletedRows: {},
      totalDeleted: 0,
    } satisfies DatabaseResetResult);
    const service = new DatabaseResetService(repo);

    const result = service.reset({
      confirmation: DATABASE_RESET_CONFIRMATION_PHRASE,
      backupPath: "C:\\backups\\liratek-2026-09-09.db",
    });

    expect(result.success).toBe(true);
    expect(result.data?.backupPath).toBe("C:\\backups\\liratek-2026-09-09.db");
  });

  it("omits backupPath from the result when none was provided", () => {
    const repo = makeMockRepo();
    (repo.resetTenantData as jest.Mock).mockReturnValue({
      deletedRows: {},
      totalDeleted: 0,
    } satisfies DatabaseResetResult);
    const service = new DatabaseResetService(repo);

    const result = service.reset({
      confirmation: DATABASE_RESET_CONFIRMATION_PHRASE,
    });

    expect(result.data?.backupPath).toBeUndefined();
  });

  it("returns success: false (not a thrown error) when the repository throws", () => {
    const repo = makeMockRepo();
    (repo.resetTenantData as jest.Mock).mockImplementation(() => {
      throw new Error("disk full");
    });
    const service = new DatabaseResetService(repo);

    const result = service.reset({
      confirmation: DATABASE_RESET_CONFIRMATION_PHRASE,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("disk full");
  });
});

describe("DatabaseResetService.preview", () => {
  it("delegates directly to the repository", () => {
    const repo = makeMockRepo();
    const preview = { counts: { sales: 2 }, totalRows: 2 };
    (repo.previewCounts as jest.Mock).mockReturnValue(preview);
    const service = new DatabaseResetService(repo);

    const result = service.preview();

    expect(repo.previewCounts).toHaveBeenCalledTimes(1);
    expect(result).toBe(preview);
  });
});
