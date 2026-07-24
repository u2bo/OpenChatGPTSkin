import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ThemeIdSchema,
  ThemeVersionSchema,
} from "@open-chatgpt-skin/theme-schema";
import { RuntimeBuiltinThemeIdSchema } from "../themes/ids.js";
import { CONTROL_COMMANDS, CONTROL_PROTOCOL_VERSION } from "./result.js";
import { CONTROL_MAX_FRAME_BYTES } from "./framing.js";
import { RUNTIME_ERROR_CODES } from "../errors.js";

export {
  CONTROL_PROTOCOL_VERSION,
  ControlCommandSchema,
  ControlErrorSchema,
  ControlResponseSchema,
  RuntimeStatusViewSchema,
} from "./result.js";
export type {
  ControlError,
  ControlResponse,
  RuntimeStatusView,
} from "./result.js";

export const NIL_REQUEST_ID = "00000000-0000-0000-0000-000000000000";

const emptyParams = z.object({}).strict();
const themeParams = z.object({
  themeId: ThemeIdSchema,
  themeVersion: ThemeVersionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.themeVersion === undefined &&
    !RuntimeBuiltinThemeIdSchema.safeParse(value.themeId).success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["themeVersion"],
      message: "personal themes require an exact version",
    });
  }
});

export const ControlRequestSchema = z.discriminatedUnion("command", [
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    command: z.literal("launch"),
    params: themeParams,
  }).strict(),
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    command: z.literal("status"),
    params: emptyParams,
  }).strict(),
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    command: z.literal("switch"),
    params: themeParams,
  }).strict(),
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    command: z.literal("pause"),
    params: emptyParams,
  }).strict(),
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    command: z.literal("resume"),
    params: emptyParams,
  }).strict(),
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    command: z.literal("restore"),
    params: emptyParams,
  }).strict(),
]);

export type ControlRequest = z.infer<typeof ControlRequestSchema>;
export type ControlCommand = ControlRequest["command"];

export const RUNTIME_CONTROL_CONTRACT = {
  protocolVersion: CONTROL_PROTOCOL_VERSION,
  frame: {
    encoding: "json" as const,
    byteOrder: "little-endian" as const,
    lengthPrefixBytes: 4,
    maxPayloadBytes: CONTROL_MAX_FRAME_BYTES,
  },
  commands: CONTROL_COMMANDS,
  readOnlyCommands: ["status"],
  mutationConcurrency: "serialized" as const,
  statusConcurrency: "parallel-with-mutation" as const,
  requestIdSemantics: "same-id-same-command-replays; same-id-different-command-rejected" as const,
  afterResponseCommands: ["launch", "restore"],
  errors: RUNTIME_ERROR_CODES,
} as const;

export const RUNTIME_CONTROL_SEMANTIC_CASES = [
  { name: "status during mutation", valid: true, command: "status", expectedConcurrency: "parallel-with-mutation" },
  { name: "duplicate request replay", valid: true, command: "switch", expectedBehavior: "replay-stored-response" },
  { name: "request ID reused for another command", valid: false, command: "pause", expectedErrorCode: "RUNTIME_INVALID_STATE", expectedPath: "/requestId" },
  { name: "oversized frame", valid: false, expectedErrorCode: "RUNTIME_CONTROL_UNAVAILABLE", expectedPath: "/frame/length" },
  { name: "restore callback after response", valid: true, command: "restore", expectedBehavior: "after-response" },
  { name: "personal theme without version", valid: false, command: "launch", expectedErrorCode: "THEME_NOT_FOUND", expectedPath: "/params/themeVersion" },
] as const;

export function pipeNameForSid(sid: string): string {
  const digest = createHash("sha256").update(sid, "utf8").digest("hex").slice(0, 24);
  return `\\\\.\\pipe\\OpenChatGPTSkin-${digest}`;
}

export function controlEndpointForIdentity(
  identity: string,
  platform: NodeJS.Platform = process.platform,
  socketDirectory = "/tmp",
): string {
  if (platform === "win32") return pipeNameForSid(identity);
  if (platform === "darwin") {
    const digest = createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 24);
    return `${socketDirectory.replace(/\/$/, "")}/OpenChatGPTSkin-${digest}.sock`;
  }
  throw new Error(`Unsupported Runtime control platform: ${platform}`);
}
