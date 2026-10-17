import { execSync } from "node:child_process";

/** Bygg-id: Vercels commit-SHA, annars lokal git-commit, annars "dev". */
export function buildId() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA;
  if (v) return v.slice(0, 12);
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().slice(0, 12); } catch { return "dev"; }
}
