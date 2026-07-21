import { RuntimeError } from "./errors.js";

export type ProbeCommand =
  | { readonly mode: "start"; readonly recordEvidence: boolean }
  | { readonly mode: "finalize" };

export function parseProbeArguments(args: readonly string[]): ProbeCommand {
  if (args.length === 0) return { mode: "start", recordEvidence: false };
  if (args.length === 1 && args[0] === "--record-evidence") {
    return { mode: "start", recordEvidence: true };
  }
  if (args.length === 1 && args[0] === "--finalize") {
    return { mode: "finalize" };
  }
  throw new RuntimeError(
    "RUNTIME_ENVIRONMENT_INVALID",
    "probe accepts only --record-evidence or --finalize",
  );
}
