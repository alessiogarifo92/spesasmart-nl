import { execFileSync } from "node:child_process";
import "dotenv/config";

/** Migrates and seeds the test database, so the pages have the labelled demo catalogue to show. */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set; see .env.example");
  const env = { ...process.env, DATABASE_URL: url };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  execFileSync("npx", ["prisma", "db", "seed"], { env, stdio: "inherit" });
}
