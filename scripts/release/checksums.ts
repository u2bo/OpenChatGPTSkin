import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function writeReleaseChecksums(outputDirectoryInput: string): Promise<string> {
  const outputDirectory = resolve(outputDirectoryInput);
  const releaseSuffixes = [".zip", ".tar.gz", ".exe", ".dmg"] as const;
  const files = (await readdir(outputDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && releaseSuffixes.some((suffix) => entry.name.endsWith(suffix)))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error("No Release artifacts are available for checksums");
  const lines: string[] = [];
  for (const file of files) {
    const path = join(outputDirectory, file);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Release artifact is not a file: ${file}`);
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    lines.push(`${digest}  ${file}`);
  }
  const checksums = join(outputDirectory, "checksums.txt");
  await writeFile(checksums, `${lines.join("\n")}\n`, "utf8");
  return checksums;
}
