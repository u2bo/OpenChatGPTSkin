import { verifyGeneratedContracts } from "./build.js";
import { verifyGoThemeContract } from "../build-go-theme-contract.js";

try {
  const [contracts, goThemeContract] = await Promise.all([
    verifyGeneratedContracts(process.cwd()),
    verifyGoThemeContract(process.cwd()),
  ]);
  process.stdout.write(`${JSON.stringify({
    ...contracts,
    goThemeContract: goThemeContract.verified,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
