#!/usr/bin/env node
// PreToolUse hook: deny PowerShell tool calls that run `yarn`.
// On this Windows setup, yarn pipes/output disappear through PowerShell — use Bash with `cmd /c "yarn ..."` instead.

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(raw || "{}");
    const cmd = (j.tool_input && j.tool_input.command) || "";
    if (/(^|[^A-Za-z0-9_-])yarn([^A-Za-z0-9_-]|$)/.test(cmd)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              'Run yarn via the Bash tool using `cmd /c "yarn ..."`. PowerShell output is unreliable for yarn on this Windows setup.',
          },
        }),
      );
    }
  } catch {
    // Ignore parse failures — never block on hook errors.
  }
});
