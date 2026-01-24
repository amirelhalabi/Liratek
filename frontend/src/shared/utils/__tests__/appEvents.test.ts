import { appEvents } from "../appEvents";

test("appEvents on/emit/off works", () => {
  const calls: any[] = [];
  const off = appEvents.on("ping", (x: any) => calls.push(x));
  appEvents.emit("ping", 1);
  appEvents.emit("ping", 2);
  expect(calls).toEqual([1, 2]);
  off();
  appEvents.emit("ping", 3);
  expect(calls).toEqual([1, 2]);
});
