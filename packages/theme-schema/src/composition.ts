import { z } from "zod";

const assetKey = z.string().max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const THEME_MAX_COMPOSITION_LAYERS = 24 as const;

export const ThemeCompositionSurfaceSchema = z.enum([
  "viewport",
  "main",
  "home-hero",
  "suggestions",
]);

export const ThemeCompositionAnchorSchema = z.enum([
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);

export const ThemeCompositionAssetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("portrait") }).strict(),
  z.object({
    kind: z.literal("decoration"),
    assetKey,
  }).strict(),
]);

export const ThemeCompositionLayerSchema = z.object({
  id: assetKey,
  asset: ThemeCompositionAssetSchema,
  surface: ThemeCompositionSurfaceSchema,
  anchor: ThemeCompositionAnchorSchema,
  positionX: z.number().min(0).max(1),
  positionY: z.number().min(0).max(1),
  width: z.number().min(0.02).max(1.5),
  opacity: z.number().min(0).max(1),
  rotation: z.number().min(-180).max(180),
  required: z.boolean(),
}).strict();

export const ThemeCompositionSchema = z.object({
  layers: z.array(ThemeCompositionLayerSchema).max(THEME_MAX_COMPOSITION_LAYERS),
}).strict().superRefine((composition, context) => {
  const ids = composition.layers.map((layer) => layer.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["layers"],
      message: "composition layer IDs must be unique",
    });
  }
});

export type ThemeCompositionLayer = z.infer<typeof ThemeCompositionLayerSchema>;

export interface ResolvedCompositionLayer extends Omit<
  ThemeCompositionLayer,
  "positionX" | "positionY" | "width" | "rotation"
> {
  readonly positionXPercent: number;
  readonly positionYPercent: number;
  readonly widthPercent: number;
  readonly rotationDeg: number;
}

export function resolveCompositionLayer(
  layer: ThemeCompositionLayer,
): ResolvedCompositionLayer {
  return {
    ...layer,
    positionXPercent: layer.positionX * 100,
    positionYPercent: layer.positionY * 100,
    widthPercent: layer.width * 100,
    rotationDeg: layer.rotation,
  };
}
