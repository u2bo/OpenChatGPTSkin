import { runtimeErrorCode } from "./errors.js";
import { parseInternalRuntimeArguments } from "./cli/arguments.js";
import { runRuntimeCli } from "./cli/run.js";
import {
  createProductionRuntimeCliDependencies,
  serveProductionRuntimeController,
  startupFailureResponse,
  startupReadyResponse,
} from "./controller/production.js";
import { prepareProductionRuntimePaths } from "./paths.js";

function writeJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  let command;
  try {
    command = parseInternalRuntimeArguments(process.argv.slice(2));
  } catch (error) {
    process.exitCode = 64;
    writeJson(process.stderr, { error: { code: runtimeErrorCode(error) } });
    return;
  }

  if (command.kind === "serve") {
    try {
      await prepareProductionRuntimePaths();
      await serveProductionRuntimeController(command.mode);
      writeJson(process.stdout, startupReadyResponse(command.startupId));
    } catch (error) {
      process.exitCode = 69;
      writeJson(process.stdout, startupFailureResponse(command.startupId, error));
    }
    return;
  }

  try {
    await prepareProductionRuntimePaths();
    const dependencies = createProductionRuntimeCliDependencies();
    process.exitCode = await runRuntimeCli(command.kind === "list-themes"
      ? ["list-themes"]
      : process.argv.slice(2), dependencies, {
      stdout: (value) => process.stdout.write(value),
      stderr: (value) => process.stderr.write(value),
    });
  } catch (error) {
    process.exitCode = 69;
    writeJson(process.stderr, { error: { code: runtimeErrorCode(error) } });
  }
}

void main();
