import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type BaselineImplementation = "node" | "go";
export type BaselineSuite = "studio" | "runtime" | "theme" | "data";

export interface BaselineSuiteResult {
  readonly implementation: "node";
  readonly suite: BaselineSuite;
  readonly result: Readonly<Record<string, unknown>>;
}

interface FrozenNodeBaseline {
  readonly implementation: "node";
  readonly suites: readonly BaselineSuiteResult[];
  readonly review: {
    readonly status: "reviewed";
    readonly knownNodeBugs: readonly string[];
  };
}

export class BaselineRunnerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BaselineRunnerError";
  }
}

async function readFrozenNodeBaseline(workspaceRootInput: string): Promise<FrozenNodeBaseline> {
  const workspaceRoot = resolve(workspaceRootInput);
  const path = join(workspaceRoot, "host", "go", "testdata", "v0.2.0", "golden", "node.json");
  const value = JSON.parse(await readFile(path, "utf8")) as FrozenNodeBaseline;
  const suites = value.suites?.map(({ suite }) => suite);
  if (value.implementation !== "node" || value.review?.status !== "reviewed" ||
    JSON.stringify(suites) !== JSON.stringify(["studio", "runtime", "theme", "data"])) {
    throw new BaselineRunnerError("NODE_BASELINE_GOLDEN_INVALID", "The reviewed Node v0.2.0 golden result is invalid");
  }
  return value;
}

function assertReadOnlyImplementation(implementation: BaselineImplementation): asserts implementation is "node" {
  if (implementation !== "node") {
    throw new BaselineRunnerError(
      "GO_BASELINE_IMPLEMENTATION_UNAVAILABLE",
      "The compatibility runner exposes only the frozen v0.2.0 Node result; current Go behavior is tested directly",
    );
  }
}

export async function runBaselineSuite(
  workspaceRoot: string,
  implementation: BaselineImplementation,
  suite: BaselineSuite,
): Promise<BaselineSuiteResult> {
  assertReadOnlyImplementation(implementation);
  const baseline = await readFrozenNodeBaseline(workspaceRoot);
  const result = baseline.suites.find((entry) => entry.suite === suite);
  if (!result) throw new BaselineRunnerError("NODE_BASELINE_GOLDEN_INVALID", `Missing frozen Node suite: ${suite}`);
  return result;
}

export async function runBaselineCorpus(
  workspaceRoot: string,
  implementation: BaselineImplementation,
): Promise<FrozenNodeBaseline> {
  assertReadOnlyImplementation(implementation);
  return readFrozenNodeBaseline(workspaceRoot);
}

function parseArguments(arguments_: readonly string[]): {
  readonly implementation: BaselineImplementation;
  readonly suite?: BaselineSuite;
} {
  let implementation: BaselineImplementation | undefined;
  let suite: BaselineSuite | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--implementation") {
      const value = arguments_[++index];
      if (value !== "node" && value !== "go") throw new Error("--implementation must be node or go");
      implementation = value;
    } else if (argument === "--suite") {
      const value = arguments_[++index];
      if (value !== "studio" && value !== "runtime" && value !== "theme" && value !== "data") {
        throw new Error("--suite must be studio, runtime, theme, or data");
      }
      suite = value;
    } else {
      throw new Error(`Unknown baseline runner argument: ${argument}`);
    }
  }
  if (!implementation) throw new Error("--implementation is required");
  return suite === undefined ? { implementation } : { implementation, suite };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = options.suite
      ? await runBaselineSuite(process.cwd(), options.implementation, options.suite)
      : await runBaselineCorpus(process.cwd(), options.implementation);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof BaselineRunnerError ? error.code : "BASELINE_RUNNER_FAILED";
    process.stderr.write(`${JSON.stringify({ error: { code, message: error instanceof Error ? error.message : String(error) } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
