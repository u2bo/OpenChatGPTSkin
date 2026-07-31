import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outputLimitBytes = 1024 * 1024;
const backgroundPNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export type ThemeCLIAcceptanceCommand =
  | "contract" | "create" | "config" | "show"
  | "validate" | "pack" | "unpack";

export interface ThemeCLIFailureEvidence {
  readonly scenario:
    | "missing-required-option"
    | "missing-background"
    | "existing-project"
    | "invalid-config"
    | "existing-archive"
    | "existing-unpack-directory";
  readonly exitCode: 1 | 2;
  readonly errorCode:
    | "CLI_ARGUMENT_INVALID"
    | "CLI_READ"
    | "CLI_WRITE"
    | "THEME_SCHEMA_INVALID";
}

export interface ThemeCLIAgentAcceptanceEvidence {
  readonly accepted: true;
  readonly contractVersion: 1;
  readonly protocolVersion: 1;
  readonly themeSchemaVersion: 4;
  readonly workflow: readonly ThemeCLIAcceptanceCommand[];
  readonly pathCoverage: { readonly spaces: true; readonly unicode: true };
  readonly failureScenarios: readonly ThemeCLIFailureEvidence[];
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ThemeCLIExecutionContext {
  readonly executablePath: string;
  readonly label: string;
}

interface ExpectedFailure extends ThemeCLIFailureEvidence {
  readonly command: ThemeCLIAcceptanceCommand;
  readonly arguments: readonly string[];
}

function runProcess(
  context: ThemeCLIExecutionContext,
  arguments_: readonly string[],
  commandLabel: string,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(context.executablePath, arguments_, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const rejectOnce = (message: string): void => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    const collect = (
      stream: "stdout" | "stderr",
      chunks: Buffer[],
      chunk: Buffer | string,
    ): void => {
      if (settled) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stream === "stdout") stdoutBytes += value.length;
      else stderrBytes += value.length;
      if (stdoutBytes > outputLimitBytes || stderrBytes > outputLimitBytes) {
        child.kill();
        rejectOnce(`${commandLabel} exceeded the process output limit`);
        return;
      }
      chunks.push(value);
    };

    child.stdout.on("data", (chunk: Buffer | string) => collect("stdout", stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer | string) => collect("stderr", stderrChunks, chunk));
    child.once("error", (error: NodeJS.ErrnoException) => {
      const code = typeof error.code === "string" ? error.code : "PROCESS_START_FAILED";
      rejectOnce(`${commandLabel} could not start (${code})`);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      if (signal || typeof exitCode !== "number") {
        rejectOnce(`${commandLabel} terminated unexpectedly`);
        return;
      }
      settled = true;
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function parseJSONObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} did not return one JSON value`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} did not return a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function runSuccess(
  context: ThemeCLIExecutionContext,
  command: ThemeCLIAcceptanceCommand,
  arguments_: readonly string[],
  detail?: string,
): Promise<Record<string, unknown>> {
  const commandLabel = `${context.label} theme ${command}${detail ? ` (${detail})` : ""}`;
  const result = await runProcess(context, ["theme", command, ...arguments_], commandLabel);
  if (result.exitCode !== 0) {
    throw new Error(`${commandLabel} exited with ${result.exitCode}`);
  }
  if (result.stderr !== "") {
    throw new Error(`${commandLabel} wrote unexpected stderr`);
  }
  return parseJSONObject(result.stdout, commandLabel);
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} returned an unexpected JSON shape`);
  }
}

async function runFailure(
  context: ThemeCLIExecutionContext,
  expected: ExpectedFailure,
  contractErrorCodes: ReadonlySet<string>,
): Promise<ThemeCLIFailureEvidence> {
  const commandLabel = `${context.label} theme ${expected.command} (${expected.scenario})`;
  const result = await runProcess(
    context,
    ["theme", expected.command, ...expected.arguments],
    commandLabel,
  );
  if (result.exitCode !== expected.exitCode) {
    throw new Error(`${commandLabel} exited with ${result.exitCode}, expected ${expected.exitCode}`);
  }
  if (result.stdout !== "") {
    throw new Error(`${commandLabel} wrote unexpected stdout`);
  }
  const envelope = parseJSONObject(result.stderr, commandLabel);
  requireExactKeys(envelope, ["error"], commandLabel);
  const error = envelope.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    throw new Error(`${commandLabel} returned an invalid error object`);
  }
  const errorObject = error as Record<string, unknown>;
  requireExactKeys(errorObject, ["code", "message"], commandLabel);
  if (errorObject.code !== expected.errorCode) {
    throw new Error(`${commandLabel} returned ${String(errorObject.code)}, expected ${expected.errorCode}`);
  }
  if (typeof errorObject.message !== "string" || errorObject.message.trim() === "") {
    throw new Error(`${commandLabel} returned an empty error message`);
  }
  if (!contractErrorCodes.has(expected.errorCode)) {
    throw new Error(`${commandLabel} returned an error code missing from theme contract`);
  }
  return {
    scenario: expected.scenario,
    exitCode: expected.exitCode,
    errorCode: expected.errorCode,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function validateContract(contract: Record<string, unknown>, label: string): ReadonlySet<string> {
  const commands = requireRecord(contract.commands, `${label} commands`);
  const exitCodes = requireRecord(contract.exitCodes, `${label} exitCodes`);
  const output = requireRecord(contract.output, `${label} output`);
  const successOutput = requireRecord(output.success, `${label} success output`);
  const failureOutput = requireRecord(output.failure, `${label} failure output`);
  const requiredCommands: readonly ThemeCLIAcceptanceCommand[] = [
    "contract", "create", "config", "show", "validate", "pack", "unpack",
  ];
  const errorCodes = contract.errorCodes;
  if (contract.role !== "theme" || contract.contractVersion !== 1 ||
    contract.protocolVersion !== 1 || contract.themeSchemaVersion !== 4 ||
    requiredCommands.some((command) => typeof commands[command] !== "string") ||
    typeof contract.themeSchema !== "object" || contract.themeSchema === null ||
    typeof contract.draftSchema !== "object" || contract.draftSchema === null ||
    typeof contract.archive !== "object" || contract.archive === null ||
    exitCodes.success !== 0 || exitCodes.failure !== 1 || exitCodes.usage !== 2 ||
    successOutput.stream !== "stdout" || successOutput.format !== "json" || successOutput.values !== 1 ||
    failureOutput.stream !== "stderr" || failureOutput.format !== "json" || failureOutput.values !== 1 ||
    !Array.isArray(errorCodes) || errorCodes.some((code) => typeof code !== "string")) {
    throw new Error(`${label} is invalid`);
  }
  return new Set(errorCodes as string[]);
}

function requireConfiguredTheme(result: Record<string, unknown>, label: string): void {
  const theme = requireRecord(result.theme, `${label} theme`);
  const colors = requireRecord(theme.colors, `${label} theme colors`);
  if (theme.name !== "Agent Theme" || theme.author !== "Agent Acceptance" ||
    theme.description !== "Native Agent acceptance" || colors.accent !== "#abcdef") {
    throw new Error(`${label} did not preserve the accepted configuration`);
  }
}

export async function acceptThemeCLIExecutable(
  executablePath: string,
  label: string,
): Promise<ThemeCLIAgentAcceptanceEvidence> {
  const context: ThemeCLIExecutionContext = { executablePath, label };
  const root = await mkdtemp(join(tmpdir(), "openchatgptskin-theme-cli-agent-"));
  const workflow: ThemeCLIAcceptanceCommand[] = [];
  const failureScenarios: ThemeCLIFailureEvidence[] = [];
  const runWorkflow = async (
    command: ThemeCLIAcceptanceCommand,
    arguments_: readonly string[],
  ): Promise<Record<string, unknown>> => {
    const result = await runSuccess(context, command, arguments_);
    workflow.push(command);
    return result;
  };

  try {
    const complexRoot = join(root, "Agent 验收 路径");
    const background = join(complexRoot, "背景 图片.png");
    const missingBackground = join(complexRoot, "缺失 背景.png");
    const validPatch = join(complexRoot, "有效 配置.json");
    const invalidPatch = join(complexRoot, "无效 配置.json");
    const project = join(complexRoot, "主题 项目");
    const archive = join(complexRoot, "主题 包.ocskin");
    const unpacked = join(complexRoot, "解包 项目");
    if (!complexRoot.includes(" ") || !/[^\u0000-\u007f]/u.test(complexRoot)) {
      throw new Error(`${label} complex-path fixture is invalid`);
    }
    await mkdir(complexRoot, { recursive: true });
    await Promise.all([
      writeFile(background, backgroundPNG),
      writeFile(validPatch, `${JSON.stringify({
        description: "Native Agent acceptance",
        colors: { accent: "#abcdef" },
        background: { overlay: 0.5 },
      })}\n`, "utf8"),
      writeFile(invalidPatch, `${JSON.stringify({ id: null })}\n`, "utf8"),
    ]);

    const contract = await runWorkflow("contract", []);
    const contractErrorCodes = validateContract(contract, `${label} theme contract`);

    const createArguments = [
      "--dir", project,
      "--id", "agent-theme",
      "--name", "Agent Theme",
      "--author", "Agent Acceptance",
      "--appearance", "dark",
      "--background", background,
    ] as const;
    const failures: readonly ExpectedFailure[] = [
      {
        scenario: "missing-required-option",
        command: "create",
        arguments: ["--id", "agent-theme", "--name", "Agent Theme", "--author", "Agent Acceptance"],
        exitCode: 2,
        errorCode: "CLI_ARGUMENT_INVALID",
      },
      {
        scenario: "missing-background",
        command: "create",
        arguments: [
          "--dir", project,
          "--id", "agent-theme",
          "--name", "Agent Theme",
          "--author", "Agent Acceptance",
          "--background", missingBackground,
        ],
        exitCode: 1,
        errorCode: "CLI_READ",
      },
    ];
    for (const failure of failures) {
      failureScenarios.push(await runFailure(context, failure, contractErrorCodes));
    }

    const created = await runWorkflow("create", createArguments);
    if (created.created !== true || created.complete !== true) {
      throw new Error(`${label} theme create result is invalid`);
    }
    failureScenarios.push(await runFailure(context, {
      scenario: "existing-project",
      command: "create",
      arguments: createArguments,
      exitCode: 1,
      errorCode: "CLI_WRITE",
    }, contractErrorCodes));

    const configured = await runWorkflow("config", ["--dir", project, "--patch", validPatch]);
    if (configured.configured !== true) {
      throw new Error(`${label} theme config result is invalid`);
    }
    const shown = await runWorkflow("show", ["--dir", project]);
    requireConfiguredTheme(shown, `${label} theme show`);

    failureScenarios.push(await runFailure(context, {
      scenario: "invalid-config",
      command: "config",
      arguments: ["--dir", project, "--patch", invalidPatch],
      exitCode: 1,
      errorCode: "THEME_SCHEMA_INVALID",
    }, contractErrorCodes));
    const shownAfterInvalidConfig = await runSuccess(
      context,
      "show",
      ["--dir", project],
      "after invalid config",
    );
    requireConfiguredTheme(shownAfterInvalidConfig, `${label} theme show after invalid config`);

    const validated = await runWorkflow("validate", ["--dir", project]);
    if (validated.valid !== true || validated.draft !== false) {
      throw new Error(`${label} theme validate result is invalid`);
    }
    const packArguments = ["--dir", project, "--out", archive] as const;
    const packed = await runWorkflow("pack", packArguments);
    if (packed.packed !== true) {
      throw new Error(`${label} theme pack result is invalid`);
    }
    failureScenarios.push(await runFailure(context, {
      scenario: "existing-archive",
      command: "pack",
      arguments: packArguments,
      exitCode: 1,
      errorCode: "CLI_WRITE",
    }, contractErrorCodes));
    const unpackArguments = ["--file", archive, "--out", unpacked] as const;
    const unpackResult = await runWorkflow("unpack", unpackArguments);
    if (unpackResult.unpacked !== true) {
      throw new Error(`${label} theme unpack result is invalid`);
    }
    failureScenarios.push(await runFailure(context, {
      scenario: "existing-unpack-directory",
      command: "unpack",
      arguments: unpackArguments,
      exitCode: 1,
      errorCode: "CLI_WRITE",
    }, contractErrorCodes));
    const unpackedValidation = await runWorkflow("validate", ["--dir", unpacked]);
    if (unpackedValidation.valid !== true || unpackedValidation.draft !== false) {
      throw new Error(`${label} unpacked theme validation result is invalid`);
    }

    return {
      accepted: true,
      contractVersion: 1,
      protocolVersion: 1,
      themeSchemaVersion: 4,
      workflow,
      pathCoverage: { spaces: true, unicode: true },
      failureScenarios,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
