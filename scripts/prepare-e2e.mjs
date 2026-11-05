import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
// These three fixed paths are disposable E2E artifacts only.
for (const path of ["./data/e2e.db", "./data/e2e.db-wal", "./data/e2e.db-shm"])
  rmSync(path, { force: true });
for (const entry of ["scripts/seed-demo.ts", "scripts/seed-e2e.ts"]) {
  const result = spawnSync(process.execPath, ["scripts/run-ts.mjs", entry], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_PATH: "./data/e2e.db" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
