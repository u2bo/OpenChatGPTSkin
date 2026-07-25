import { verifyFrozenBaseline } from "./baseline.js";

try {
  const result = await verifyFrozenBaseline(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
