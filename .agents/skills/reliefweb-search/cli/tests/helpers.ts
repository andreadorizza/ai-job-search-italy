import { join } from "path";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Copied from jobindex-search/cli/tests/helpers.ts, plus an `env` override:
 * a key set to `undefined` is removed from the child's environment, so tests
 * can prove the MISSING_CREDENTIALS path regardless of the caller's shell.
 */
export async function runCLI(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<CLIResult> {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined) childEnv[k] = v;
  }

  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI exited with code ${result.exitCode}. stderr: ${result.stderr}`
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(
      `Failed to parse JSON. stdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
}
