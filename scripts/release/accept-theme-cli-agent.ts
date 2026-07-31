import { resolve } from "node:path";
import { acceptThemeCLIExecutable } from "./theme-cli-agent-acceptance.js";
import { releaseOption, requiredReleaseOption } from "./options.js";

try {
  const args = process.argv.slice(2);
  const executable = resolve(requiredReleaseOption(args, "--executable"));
  const label = releaseOption(args, "--label") ?? "External Theme CLI executable";
  const result = await acceptThemeCLIExecutable(executable, label);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: "THEME_CLI_AGENT_ACCEPTANCE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    },
  }, null, 2)}\n`);
  process.exitCode = 1;
}
