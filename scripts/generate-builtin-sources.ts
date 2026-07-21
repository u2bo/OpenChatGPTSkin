import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { BUILTIN_PRESETS } from "./builtin-presets.js";

const MIN_WIDTH = 1600;
const MIN_HEIGHT = 900;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const TARGET_ASPECT_RATIO = 16 / 9;
const ASPECT_RATIO_TOLERANCE = 0.01;

for (const preset of BUILTIN_PRESETS) {
  const sourcePath = resolve(
    "themes",
    "builtin",
    preset.id,
    "assets",
    "source.png",
  );
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.size < 1 || sourceInfo.size > MAX_FILE_SIZE) {
    throw new Error(`SOURCE_IMAGE_INVALID: ${preset.id}`);
  }

  const metadata = await sharp(sourcePath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const aspectRatio = height > 0 ? width / height : 0;
  if (
    metadata.format !== "png" ||
    width < MIN_WIDTH ||
    height < MIN_HEIGHT ||
    Math.abs(aspectRatio - TARGET_ASPECT_RATIO) > ASPECT_RATIO_TOLERANCE
  ) {
    throw new Error(
      `SOURCE_IMAGE_UNSUPPORTED: ${preset.id} must be a 16:9 PNG at least ${MIN_WIDTH}x${MIN_HEIGHT}`,
    );
  }
}
