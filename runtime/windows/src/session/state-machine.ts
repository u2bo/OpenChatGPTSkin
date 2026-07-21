import { RuntimeError } from "../errors.js";
import {
  RuntimeSessionStateSchema,
  type RuntimeSessionState,
  type RuntimeStatus,
} from "../state.js";

const ALLOWED: Readonly<Record<RuntimeStatus, readonly RuntimeStatus[]>> = {
  launching: ["launching", "active", "recovery-required", "restored-awaiting-exit"],
  active: ["active", "paused", "paused-incompatible", "recovery-required", "restoring"],
  paused: ["paused", "active", "paused-incompatible", "recovery-required", "restoring"],
  "paused-incompatible": [
    "paused-incompatible",
    "paused",
    "active",
    "recovery-required",
    "restoring",
  ],
  "recovery-required": ["recovery-required", "restoring"],
  restoring: ["restoring", "active", "recovery-required", "restored-awaiting-exit"],
  "restored-awaiting-exit": ["restored-awaiting-exit", "restored-cleanup-required"],
  "restored-cleanup-required": ["restored-cleanup-required"],
};

export function transitionRuntimeState(
  current: RuntimeSessionState,
  next: RuntimeSessionState,
): RuntimeSessionState {
  if (!ALLOWED[current.status].includes(next.status)) {
    throw new RuntimeError(
      "RUNTIME_INVALID_STATE",
      `Illegal Runtime transition: ${current.status} -> ${next.status}`,
    );
  }
  return RuntimeSessionStateSchema.parse(next);
}
