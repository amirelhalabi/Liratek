/**
 * LIRA-377 T047 (rule 28d) — every offline channel's fixture payload that
 * carries a CLIENT reference must still parse through its recorded schema
 * after Apply replaces that reference with another client or with walk-in;
 * else the review service must refuse in plain words (never "different app
 * version"). Walks every family fixture (testHelpers/fixtures).
 */
import { recordedSchema } from "../channelPolicy";
import { applyClientChoice, collectIdReferences, tableOfReference } from "../restoreRefs";
import { loadAllFixtures } from "../testHelpers/bindingFixtures";

const cases = Object.values(loadAllFixtures())
  .flat()
  .map((f) => ({ f, refs: collectIdReferences(f.payload).filter((r) => tableOfReference(r) === "clients" && !r.inArray) }))
  .filter((c) => c.refs.length > 0);

it("finds fixtures with a client reference", () => {
  expect(cases.length).toBeGreaterThan(0);
});

describe.each(cases.map((c) => [c.f.channel, c] as const))("%s", (_ch, { f, refs }) => {
  const schema = recordedSchema(f.channel)!;
  const paths = refs.map((r) => r.path);
  it("parses with a replacement client", () => {
    const out = applyClientChoice(f.channel, f.payload, paths, { id: 42, name: "Hadi", phone: "70999888" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(schema.safeParse(out.payload).success).toBe(true);
  });
  it("walk-in: a payload the schema accepts, or client_required — never one the schema refuses", () => {
    const out = applyClientChoice(f.channel, f.payload, paths, null);
    if (out.ok) expect(schema.safeParse(out.payload).success).toBe(true);
    else expect(out.reason).toBe("client_required");
    // a debt action is always about one client: walk-in can never apply
    if (f.channel.startsWith("debt:")) expect(out).toEqual({ ok: false, reason: "client_required" });
  });
});
