import { z } from "zod";
import { RUNTIME_ERROR_CODES } from "../errors.js";
import {
  RuntimeOperationSchema,
  RuntimeStatusSchema,
  RuntimeThemeRefSchema,
} from "../session/model.js";

export const CONTROL_PROTOCOL_VERSION = 1 as const;

export const CONTROL_COMMANDS = [
  "launch",
  "status",
  "switch",
  "pause",
  "resume",
  "restore",
] as const;

export const ControlCommandSchema = z.enum(CONTROL_COMMANDS);

export const RuntimeStatusViewSchema = z.object({
  status: z.union([RuntimeStatusSchema, z.literal("stopped")]),
  controllerAvailable: z.boolean(),
  selectedTheme: RuntimeThemeRefSchema.nullable(),
  appliedTheme: RuntimeThemeRefSchema.nullable(),
  skinApplied: z.boolean().nullable(),
  packageVersion: z.string().max(40).nullable(),
  operation: RuntimeOperationSchema.nullable(),
  nextAction: z.string().max(500),
}).strict();

export type RuntimeStatusView = z.infer<typeof RuntimeStatusViewSchema>;

export const ControlErrorSchema = z.object({
  code: z.enum(RUNTIME_ERROR_CODES),
  message: z.string().min(1).max(500),
  nextAction: z.string().max(500).optional(),
}).strict();

export type ControlError = z.infer<typeof ControlErrorSchema>;

export const ControlResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    ok: z.literal(true),
    result: RuntimeStatusViewSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(CONTROL_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    ok: z.literal(false),
    error: ControlErrorSchema,
  }).strict(),
]);

export type ControlResponse = z.infer<typeof ControlResponseSchema>;

export interface ControlDispatchResult {
  readonly response: ControlResponse;
  readonly afterResponse?: () => Promise<void> | void;
}
