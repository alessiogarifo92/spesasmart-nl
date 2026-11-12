import type { IngestionRun, IngestionStatus, PrismaClient } from "@/generated/prisma/client";
import { isoDateInAmsterdam, type IsoDate } from "@/domain/pricing";
import type { AdapterContext, RawOffer, RetailerAdapter } from "./adapter";
import type { HttpClient } from "./http";
import { saveOffer, saveStores } from "./store";
import { adapterSwitch } from "./switches";
import { validateOffer } from "./validate";

/** Entries kept in `IngestionRun.errors`, the last one counting what was dropped. */
export const MAX_RUN_ERRORS = 50;
/** Longest message or item text kept per error entry. */
export const MAX_ERROR_LENGTH = 500;
/** Runs that count towards the daily limit. */
const COUNTED_STATUSES: IngestionStatus[] = ["RUNNING", "SUCCESS", "PARTIAL"];
/** How far back to look for runs on the same Amsterdam day. */
const DAILY_LIMIT_WINDOW_MS = 2 * 86_400_000;

export type RunnerDeps = {
  db: PrismaClient;
  /** Called once per run that is allowed to start: a fresh client re-reads robots.txt. */
  createHttp: () => HttpClient;
  now: () => Date;
  /** Parsed INGESTION_ENABLED_ADAPTERS. */
  enabledAdapters: string[];
  /** Run day; defaults to the Europe/Amsterdam date of `now()`. */
  today?: () => IsoDate;
};

export type RunError = { message: string; url?: string; item?: string };

function cut(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? text.slice(0, MAX_ERROR_LENGTH) : text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Error list of one run: capped, with long texts cut. */
class RunErrors {
  private readonly entries: RunError[] = [];
  private dropped = 0;

  add(error: RunError): void {
    if (this.entries.length >= MAX_RUN_ERRORS - 1) {
      this.dropped += 1;
      return;
    }
    const entry: RunError = { message: cut(error.message) };
    if (error.url !== undefined) entry.url = error.url;
    if (error.item !== undefined) entry.item = cut(error.item);
    this.entries.push(entry);
  }

  get count(): number {
    return this.entries.length + this.dropped;
  }

  toJson(): RunError[] {
    return this.dropped === 0
      ? this.entries
      : [...this.entries, { message: `${this.dropped} more errors not recorded` }];
  }
}

function describeItem(raw: RawOffer): string {
  return JSON.stringify(raw.payload);
}

async function runsStartedToday(db: PrismaClient, adapterId: string, now: Date, today: IsoDate): Promise<number> {
  const runs = await db.ingestionRun.findMany({
    where: {
      adapter: adapterId,
      status: { in: COUNTED_STATUSES },
      startedAt: { gte: new Date(now.getTime() - DAILY_LIMIT_WINDOW_MS) },
    },
    select: { startedAt: true },
  });
  return runs.filter((run) => isoDateInAmsterdam(run.startedAt) === today).length;
}

/**
 * Runs one adapter once and returns its IngestionRun row. Switched off or over its daily
 * limit, it records a SKIPPED run without calling the adapter. Adapter failures never
 * throw: each fetch and each item fails on its own and lands in the run's `errors`.
 */
export async function runAdapter(adapter: RetailerAdapter, deps: RunnerDeps): Promise<IngestionRun> {
  const { db } = deps;
  const startedAt = deps.now();
  const today = deps.today?.() ?? isoDateInAmsterdam(startedAt);
  const closed = (retailerId: string | null, status: IngestionStatus, message: string) =>
    db.ingestionRun.create({
      data: { adapter: adapter.id, retailerId, status, startedAt, finishedAt: deps.now(), errors: [{ message }] },
    });

  const retailer = await db.retailer.findUnique({ where: { slug: adapter.retailerSlug } });
  if (!retailer) return closed(null, "FAILED", `retailer "${adapter.retailerSlug}" not found`);

  const decision = adapterSwitch({
    adapter,
    enabledAdapters: deps.enabledAdapters,
    retailerAdapterEnabled: retailer.adapterEnabled,
  });
  if (!decision.run) return closed(retailer.id, "SKIPPED", decision.reason);

  if (!adapter.isMock) {
    const limit = adapter.maxRunsPerDay ?? 1;
    const started = await runsStartedToday(db, adapter.id, startedAt, today);
    if (started >= limit) {
      return closed(retailer.id, "SKIPPED", `daily limit: ${started} of ${limit} runs already started on ${today}`);
    }
  }

  const run = await db.ingestionRun.create({
    data: { adapter: adapter.id, retailerId: retailer.id, status: "RUNNING", startedAt },
  });
  const errors = new RunErrors();
  let found = 0;
  let saved = 0;
  try {
    const ctx: AdapterContext = { http: deps.createHttp(), today, now: startedAt };
    const raws: RawOffer[] = [];
    const fetchers = [
      ["fetchOffers", () => adapter.fetchOffers(ctx)],
      ["fetchUpcomingOffers", () => adapter.fetchUpcomingOffers(ctx)],
    ] as const;
    for (const [name, fetch] of fetchers) {
      try {
        raws.push(...(await fetch()));
      } catch (error) {
        errors.add({ message: `${name}: ${messageOf(error)}` });
      }
    }
    found = raws.length;

    for (const raw of raws) {
      const where = { url: raw.sourceUrl, item: describeItem(raw) };
      try {
        const normalized = adapter.normalizeOffer(raw, ctx);
        if (!normalized.ok) {
          errors.add({ message: `normalise: ${normalized.reason}`, ...where });
          continue;
        }
        const verdict = validateOffer(normalized.value, { today });
        if (verdict.status === "REJECTED") {
          errors.add({ message: `rejected: ${verdict.issues.join(", ")}`, ...where });
          continue;
        }
        await saveOffer(db, { retailerId: retailer.id, adapter, offer: normalized.value, verdict, now: deps.now() });
        saved += 1;
      } catch (error) {
        errors.add({ message: messageOf(error), ...where });
      }
    }

    try {
      const stores = await adapter.fetchStoreLocations(ctx);
      if (stores.length > 0) await saveStores(db, retailer.id, stores);
    } catch (error) {
      errors.add({ message: `fetchStoreLocations: ${messageOf(error)}` });
    }
  } catch (error) {
    errors.add({ message: `run aborted: ${messageOf(error)}` });
  }

  const status: IngestionStatus = errors.count === 0 ? "SUCCESS" : saved > 0 ? "PARTIAL" : "FAILED";
  return db.ingestionRun.update({
    where: { id: run.id },
    data: { status, itemsFound: found, itemsUpdated: saved, errors: errors.toJson(), finishedAt: deps.now() },
  });
}

/**
 * Runs adapters one after another. Nothing one adapter does stops the next: an unexpected
 * exception is recorded as a FAILED run. Returns every run row that could be written.
 */
export async function runAll(adapters: RetailerAdapter[], deps: RunnerDeps): Promise<IngestionRun[]> {
  const runs: IngestionRun[] = [];
  for (const adapter of adapters) {
    try {
      runs.push(await runAdapter(adapter, deps));
    } catch (error) {
      try {
        const now = deps.now();
        runs.push(
          await deps.db.ingestionRun.create({
            data: {
              adapter: adapter.id,
              status: "FAILED",
              startedAt: now,
              finishedAt: now,
              errors: [{ message: cut(`runner failed: ${messageOf(error)}`) }],
            },
          }),
        );
      } catch {
        // The database itself is failing; the next adapter still gets its turn.
      }
    }
  }
  return runs;
}
