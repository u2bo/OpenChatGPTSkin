import { z } from "zod";
import {
  ThemeIdSchema,
  ThemeVersionSchema,
} from "@open-chatgpt-skin/theme-schema";

export const RuntimeStatusSchema = z.enum([
  "launching",
  "active",
  "paused",
  "paused-incompatible",
  "recovery-required",
  "restoring",
  "restored-awaiting-exit",
  "restored-cleanup-required",
]);

export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const RuntimeOperationSchema = z.enum([
  "launch",
  "switch",
  "pause",
  "resume",
  "restore",
]);

export type RuntimeOperation = z.infer<typeof RuntimeOperationSchema>;

export const RuntimeThemeRefSchema = z.object({
  id: ThemeIdSchema,
  version: ThemeVersionSchema,
}).strict();

export type RuntimeThemeRef = z.infer<typeof RuntimeThemeRefSchema>;

export const PendingOperationSchema = z.object({
  kind: RuntimeOperationSchema,
  requestId: z.string().uuid(),
  startedAt: z.string().datetime(),
  previousStatus: RuntimeStatusSchema.nullable(),
  previousSelectedTheme: RuntimeThemeRefSchema.nullable(),
  previousAppliedTheme: RuntimeThemeRefSchema.nullable(),
  candidateTheme: RuntimeThemeRefSchema.nullable(),
}).strict();

export type PendingOperation = z.infer<typeof PendingOperationSchema>;

export const RuntimeProcessSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
}).strict();

export const RuntimeCodexIdentitySchema = z.object({
  rootPid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  executablePath: z.string().min(1),
  packageRoot: z.string().min(1),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
}).strict();

export const RuntimeCdpIdentitySchema = z.object({
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65_535),
}).strict();

export const RuntimeAdapterIdentitySchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
}).strict();
