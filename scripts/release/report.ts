import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function writeReleaseReport(
  outputPath: string | undefined,
  report: unknown,
): Promise<void> {
  if (!outputPath) return;
  const path = resolve(outputPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
