import "dotenv/config";

// Integration tests always run against the test database, never the dev one.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("TEST_DATABASE_URL is not set; see .env.example");
}
process.env.DATABASE_URL = testUrl;
