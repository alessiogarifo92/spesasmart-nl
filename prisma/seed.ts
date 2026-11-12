import "dotenv/config";
import { amsterdamToday } from "@/lib/dates";
import { seedDatabase } from "./seed/index";

async function main() {
  const { db } = await import("@/lib/db");
  const now = new Date();
  const result = await seedDatabase(db, {
    today: amsterdamToday(now),
    now,
    withDemo: process.env.SEED_DEMO !== "false",
  });
  console.log(
    `Seeded ${result.retailers} retailers, ${result.categories} categories, ` +
      `${result.products} demo products, ${result.offers} demo offers, ${result.matches} product links.`,
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
