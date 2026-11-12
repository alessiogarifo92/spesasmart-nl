import { isAllowed, parseRobots, type RobotsRules } from "./robots";

/**
 * The only way adapters reach the network: GET only, robots.txt checked on every run,
 * a per-host rate limit, a timeout per attempt and retries with exponential backoff
 * (docs/decisions.md section 3). Clock, sleep, randomness and fetch are injected.
 */

export type HttpResponse = { status: number; url: string; text: string };

export type HttpClient = { get(url: string): Promise<HttpResponse> };

export type HttpClientOptions = {
  /** Identifiable User-Agent with a contact address or URL. */
  userAgent: string;
  fetch: typeof globalThis.fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Source of backoff jitter in [0, 1). Default Math.random. */
  random?: () => number;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
};

/** Redirects followed for one request; each hop is checked against its own host's robots.txt. */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Longest wait a Retry-After header can impose. */
const RETRY_AFTER_CAP_MS = 60_000;

/** robots.txt forbids the URL, or could not be read: no request was made. */
export class RobotsDisallowedError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`robots.txt disallows ${url} (${reason})`);
    this.name = "RobotsDisallowedError";
  }
}

/** The request kept failing: `status` is the last HTTP status, null for a network error or timeout. */
export class HttpRequestError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    cause?: unknown,
  ) {
    super(
      status === null
        ? `GET ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`
        : `GET ${url} failed with status ${status}`,
      { cause },
    );
    this.name = "HttpRequestError";
  }
}

/** The robots.txt verdict for a host: parsed rules, everything allowed, or blocked. */
type HostPolicy = { kind: "rules"; rules: RobotsRules } | { kind: "allow-all" } | { kind: "blocked"; reason: string };

function assertUserAgent(userAgent: string): void {
  if (userAgent.trim() === "") throw new Error("User-Agent must not be empty");
  if (!userAgent.includes("@") && !userAgent.includes("http")) {
    throw new Error("User-Agent must name a contact address or URL");
  }
}

function parseUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Only http and https URLs can be fetched, got ${parsed.protocol}`);
  }
  return parsed;
}

function retryAfterMs(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Math.min(Number(header.trim()) * 1000, RETRY_AFTER_CAP_MS);
}

/** Creates a client; use one per run so robots.txt is read again on every run. */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  assertUserAgent(options.userAgent);
  const {
    userAgent,
    fetch,
    now,
    sleep,
    random = Math.random,
    minIntervalMs = 2000,
    timeoutMs = 15000,
    maxRetries = 3,
    backoffBaseMs = 1000,
  } = options;
  /** robots.txt product token: the text before the first "/". */
  const robotsToken = userAgent.trim().split("/")[0].split(" ")[0];
  const headers = { "User-Agent": userAgent, "Accept-Language": "nl" };
  const policies = new Map<string, Promise<HostPolicy>>();
  const lastStart = new Map<string, number>();
  const turns = new Map<string, Promise<void>>();

  /** Waits until the host's minimum interval has passed; request starts are serialised per host. */
  function throttle(host: string): Promise<void> {
    const turn = (turns.get(host) ?? Promise.resolve()).then(async () => {
      const previous = lastStart.get(host);
      if (previous !== undefined) {
        const wait = previous + minIntervalMs - now().getTime();
        if (wait > 0) await sleep(wait);
      }
      lastStart.set(host, now().getTime());
    });
    turns.set(
      host,
      turn.catch(() => undefined),
    );
    return turn;
  }

  async function attempt(url: string, host: string): Promise<Response> {
    await throttle(host);
    return fetch(url, {
      method: "GET",
      headers,
      credentials: "omit",
      // Redirects are followed by hand, so every hop passes the robots.txt check and the rate limit.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async function loadPolicy(origin: string, host: string): Promise<HostPolicy> {
    try {
      let response = await attempt(`${origin}/robots.txt`, host);
      // RFC 9309: a redirected robots.txt still governs the host that was asked.
      for (let hop = 0; hop < MAX_REDIRECTS && REDIRECT_STATUSES.has(response.status); hop++) {
        const location = response.headers.get("Location");
        if (!location) break;
        const next = parseUrl(new URL(location, response.url || `${origin}/robots.txt`).href);
        await response.body?.cancel();
        response = await attempt(next.href, next.host);
      }
      const text = await response.text();
      if (response.status >= 200 && response.status < 300) return { kind: "rules", rules: parseRobots(text) };
      if (response.status === 404 || response.status === 410) return { kind: "allow-all" };
      return {
        kind: "blocked",
        reason: `robots.txt status ${response.status}`,
      };
    } catch (error) {
      return {
        kind: "blocked",
        reason: `robots.txt unreadable: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  function policyFor(url: URL): Promise<HostPolicy> {
    let policy = policies.get(url.host);
    if (!policy) {
      policy = loadPolicy(url.origin, url.host);
      policies.set(url.host, policy);
    }
    return policy;
  }

  function backoff(attemptIndex: number): number {
    return backoffBaseMs * 2 ** attemptIndex + Math.floor(random() * backoffBaseMs);
  }

  async function get(url: string, redirectsLeft: number): Promise<HttpResponse> {
    const parsed = parseUrl(url);
    const policy = await policyFor(parsed);
    if (policy.kind === "blocked") throw new RobotsDisallowedError(url, policy.reason);
    if (policy.kind === "rules" && !isAllowed(policy.rules, robotsToken, parsed.pathname + parsed.search)) {
      throw new RobotsDisallowedError(url, `disallowed for ${robotsToken}`);
    }

    for (let attemptIndex = 0; ; attemptIndex++) {
      const last = attemptIndex >= maxRetries;
      let response: Response;
      let text: string;
      try {
        response = await attempt(url, parsed.host);
        text = await response.text();
      } catch (error) {
        if (last) throw new HttpRequestError(url, null, error);
        await sleep(backoff(attemptIndex));
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (last) throw new HttpRequestError(url, response.status);
        await sleep(retryAfterMs(response.headers.get("Retry-After")) ?? backoff(attemptIndex));
        continue;
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("Location");
        if (!location || redirectsLeft === 0) throw new HttpRequestError(url, response.status);
        return get(new URL(location, url).href, redirectsLeft - 1);
      }
      return { status: response.status, url, text };
    }
  }

  return { get: (url) => get(url, MAX_REDIRECTS) };
}

/** A client that refuses every request; for runs that must stay offline (mock adapters, the seed). */
export function createOfflineHttpClient(): HttpClient {
  return {
    async get(url) {
      throw new Error(`HTTP client is offline: refused GET ${url}`);
    },
  };
}
