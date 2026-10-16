/**
 * ClientService — a phone typed with spaces/dashes is stored as digits
 * (shop-day test 2026-10-16).
 *
 * The desktop app validates clients with `clientWriteSchema` (any non-blank
 * text), so "03 123 456" used to be stored exactly as typed, while the web
 * app stores digits only. The service now strips the formatting for BOTH
 * apps, and the duplicate-phone check looks at the same digits, so
 * "03 123 456" and "03123456" are one client. Text that is not a phone
 * (e.g. "N/A") is left as typed — it is not this change's job to reject it.
 */
import { ClientService } from "../ClientService";
import type { ClientRepository } from "../../repositories/ClientRepository";

function fakeRepo() {
  const repo = {
    phoneExists: jest.fn().mockReturnValue(false),
    createClient: jest.fn().mockReturnValue({ id: 9 }),
    exists: jest.fn().mockReturnValue(true),
    updateClientFull: jest.fn(),
  };
  return {
    repo,
    service: new ClientService(repo as unknown as ClientRepository),
  };
}

describe("ClientService — phone formatting", () => {
  it("create: '03 123 456' is checked and stored as '03123456'", () => {
    const { repo, service } = fakeRepo();
    const res = service.createClient(
      { full_name: "Hassan", phone_number: "03 123 456" },
      1,
    );
    expect(res.success).toBe(true);
    expect(repo.phoneExists).toHaveBeenCalledWith("03123456");
    expect(repo.createClient.mock.calls[0][0].phone_number).toBe("03123456");
  });

  it("update: '70-998-811' is checked and stored as '70998811'", () => {
    const { repo, service } = fakeRepo();
    const res = service.updateClient(
      4,
      { full_name: "Samir", phone_number: "70-998-811", whatsapp_opt_in: 0 },
      1,
    );
    expect(res.success).toBe(true);
    expect(repo.phoneExists).toHaveBeenCalledWith("70998811", 4);
    expect(repo.updateClientFull.mock.calls[0][1].phone_number).toBe(
      "70998811",
    );
  });

  it("text that is not a phone is kept as typed", () => {
    const { repo, service } = fakeRepo();
    service.createClient({ full_name: "Walk-in", phone_number: "N/A" }, 1);
    expect(repo.createClient.mock.calls[0][0].phone_number).toBe("N/A");
  });
});

describe("ClientService — phone formatting edge cases", () => {
  it("update without a phone (notes only) does not throw", () => {
    const { repo, service } = fakeRepo();
    const body = { full_name: "Samir", whatsapp_opt_in: 1 } as unknown as {
      full_name: string;
      phone_number: string;
      whatsapp_opt_in: number;
    };
    const res = service.updateClient(4, body, 1);
    expect(res.success).toBe(true);
    expect(repo.updateClientFull).toHaveBeenCalledTimes(1);
  });

  it("a desktop row stored as '03 123 456' still blocks the same text", () => {
    const { repo, service } = fakeRepo();
    repo.phoneExists.mockImplementation((p: string) => p === "03 123 456");
    const res = service.createClient(
      { full_name: "Hassan", phone_number: "03 123 456" },
      1,
    );
    expect(res.success).toBe(false);
    expect(repo.createClient).not.toHaveBeenCalled();
  });
});
