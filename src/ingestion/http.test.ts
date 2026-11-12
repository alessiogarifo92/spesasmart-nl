import { describe, expect, it } from "vitest";
import {
  createHttpClient,
  createOfflineHttpClient,
  HttpRequestError,
  RobotsDisallowedError,
  type HttpClientOptions,
} from "./http";

const USER_AGENT = "SpesaSmartNL/0.1 (personal project; contact: test@example.test)";

type Reply = Response | Error | "hang";
type Call = { url: string; init: RequestInit };

/** A fake fetch answering from a function, a fake clock, and a recorded sleep. */
function harness(reply: (url: string, attempt: number) => Reply, options: Partial<HttpClientOptions> = {}) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const attempts = new Map<string, number>();

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const attempt = attempts.get(url) ?? 0;
    attempts.set(url, attempt + 1);
    const answer = reply(url, attempt);
    if (answer === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof globalThis.fetch;

  const client = createHttpClient({
    userAgent: USER_AGENT,
    fetch,
    now: () => new Date(clock),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...options,
  });
  const pageCalls = () => calls.filter((call) => !call.url.endsWith("/robots.txt"));
  return {
    client,
    calls,
    pageCalls,
    sleeps,
    advance: (ms: number) => (clock += ms),
  };
}

const ok = (body = "ok") => new Response(body, { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) => new Response("", { status: code, headers });
const robots = (body: string) => (url: string) => (url.endsWith("/robots.txt") ? ok(body) : ok("page"));
const OPEN = robots("User-agent: *\nDisallow:\n");

describe("createHttpClient", () => {
  it("refuses a user agent without a way to reach the operator", () => {
    const base = {
      fetch: globalThis.fetch,
      now: () => new Date(),
      sleep: async () => {},
    };
    expect(() => createHttpClient({ ...base, userAgent: "" })).toThrow(/User-Agent/);
    expect(() => createHttpClient({ ...base, userAgent: "   " })).toThrow(/User-Agent/);
    expect(() => createHttpClient({ ...base, userAgent: "SpesaSmartNL/0.1" })).toThrow(/contact/);
    expect(() =>
      createHttpClient({
        ...base,
        userAgent: "SpesaSmartNL/0.1 (me@example.test)",
      }),
    ).not.toThrow();
    expect(() =>
      createHttpClient({
        ...base,
        userAgent: "SpesaSmartNL/0.1 (+https://example.test)",
      }),
    ).not.toThrow();
  });

  it("checks robots.txt once per host before the first request and sends only the two headers", async () => {
    const { client, calls } = harness(OPEN);
    const response = await client.get("https://shop.example.test/aanbiedingen");
    await client.get("https://shop.example.test/aanbiedingen?page=2");

    expect(response).toEqual({
      status: 200,
      url: "https://shop.example.test/aanbiedingen",
      text: "page",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://shop.example.test/robots.txt",
      "https://shop.example.test/aanbiedingen",
      "https://shop.example.test/aanbiedingen?page=2",
    ]);
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      expect(call.init.headers).toEqual({
        "User-Agent": USER_AGENT,
        "Accept-Language": "nl",
      });
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("never requests a URL that robots.txt disallows for its product token", async () => {
    const { client, calls, pageCalls } = harness(
      robots("User-agent: *\nAllow: /\n\nUser-agent: SpesaSmartNL\nDisallow: /aanbiedingen\n"),
    );
    await expect(client.get("https://shop.example.test/aanbiedingen/week")).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
    await expect(client.get("https://shop.example.test/folder")).resolves.toMatchObject({ status: 200 });
    expect(pageCalls().map((call) => call.url)).toEqual(["https://shop.example.test/folder"]);
    expect(calls.filter((call) => call.url.endsWith("/robots.txt"))).toHaveLength(1);
  });

  it.each<[string, (url: string) => Reply]>([
    ["a server error", (url) => (url.endsWith("/robots.txt") ? status(500) : ok())],
    ["a 403", (url) => (url.endsWith("/robots.txt") ? status(403) : ok())],
    ["a network error", (url) => (url.endsWith("/robots.txt") ? new TypeError("fetch failed") : ok())],
    ["a timeout", (url) => (url.endsWith("/robots.txt") ? "hang" : ok())],
  ])("blocks the whole host when robots.txt answers with %s", async (_, reply) => {
    const { client, calls, pageCalls } = harness(reply, { timeoutMs: 5 });
    await expect(client.get("https://shop.example.test/aanbiedingen")).rejects.toBeInstanceOf(RobotsDisallowedError);
    await expect(client.get("https://shop.example.test/anders")).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(pageCalls()).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it.each([404, 410])("allows everything when robots.txt is %i", async (code) => {
    const { client, pageCalls } = harness((url) => (url.endsWith("/robots.txt") ? status(code) : ok()));
    await expect(client.get("https://shop.example.test/aanbiedingen")).resolves.toMatchObject({ status: 200 });
    expect(pageCalls()).toHaveLength(1);
  });

  it("keeps the minimum interval between request starts per host", async () => {
    const { client, sleeps, advance } = harness(OPEN, { minIntervalMs: 2000 });
    await client.get("https://a.example.test/1");
    expect(sleeps).toEqual([2000]); // robots.txt started the clock
    advance(500);
    await client.get("https://a.example.test/2");
    expect(sleeps).toEqual([2000, 1500]);
    advance(5000);
    await client.get("https://a.example.test/3");
    expect(sleeps).toEqual([2000, 1500]);
    // Another host has its own interval: only its robots.txt comes first.
    await client.get("https://b.example.test/1");
    expect(sleeps).toEqual([2000, 1500, 2000]);
  });

  it("retries 5xx with exponential backoff plus jitter, then succeeds", async () => {
    const { client, pageCalls, sleeps } = harness(
      (url, attempt) => (url.endsWith("/robots.txt") ? status(404) : attempt < 2 ? status(503) : ok("done")),
      { minIntervalMs: 0, backoffBaseMs: 1000 },
    );
    await expect(client.get("https://shop.example.test/x")).resolves.toMatchObject({ status: 200, text: "done" });
    expect(pageCalls()).toHaveLength(3);
    // base × 2^attempt + random() × base, with random() = 0.5.
    expect(sleeps).toEqual([1500, 2500]);
  });

  it("throws HttpRequestError with the status after the last retry", async () => {
    const { client, pageCalls, sleeps } = harness((url) => (url.endsWith("/robots.txt") ? status(404) : status(502)), {
      minIntervalMs: 0,
      maxRetries: 3,
    });
    const error = await client.get("https://shop.example.test/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error).toMatchObject({
      status: 502,
      url: "https://shop.example.test/x",
    });
    expect(pageCalls()).toHaveLength(4);
    expect(sleeps).toEqual([1500, 2500, 4500]);
  });

  it("retries network errors and reports the cause", async () => {
    const cause = new TypeError("fetch failed");
    const { client, pageCalls } = harness((url) => (url.endsWith("/robots.txt") ? status(404) : cause), {
      minIntervalMs: 0,
      maxRetries: 2,
    });
    const error = await client.get("https://shop.example.test/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpRequestError);
    expect((error as HttpRequestError).status).toBeNull();
    expect((error as HttpRequestError).cause).toBe(cause);
    expect(pageCalls()).toHaveLength(3);
  });

  it("retries 429 and honours Retry-After seconds, capped at 60 s", async () => {
    const replies = [status(429, { "Retry-After": "7" }), status(429, { "Retry-After": "600" }), ok()];
    const { client, sleeps } = harness(
      (url, attempt) => (url.endsWith("/robots.txt") ? status(404) : replies[attempt]),
      { minIntervalMs: 0 },
    );
    await expect(client.get("https://shop.example.test/x")).resolves.toMatchObject({ status: 200 });
    expect(sleeps).toEqual([7000, 60000]);
  });

  it("falls back to backoff when Retry-After is not a number of seconds", async () => {
    const replies = [status(503, { "Retry-After": "Wed, 11 Nov 2026 08:00:00 GMT" }), ok()];
    const { client, sleeps } = harness(
      (url, attempt) => (url.endsWith("/robots.txt") ? status(404) : replies[attempt]),
      { minIntervalMs: 0 },
    );
    await client.get("https://shop.example.test/x");
    expect(sleeps).toEqual([1500]);
  });

  it("returns other 4xx to the caller without retrying", async () => {
    const { client, pageCalls, sleeps } = harness(
      (url) => (url.endsWith("/robots.txt") ? status(404) : new Response("weg", { status: 404 })),
      { minIntervalMs: 0 },
    );
    await expect(client.get("https://shop.example.test/x")).resolves.toEqual({
      status: 404,
      url: "https://shop.example.test/x",
      text: "weg",
    });
    expect(pageCalls()).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("aborts an attempt after the timeout and retries it", async () => {
    const { client, pageCalls } = harness(
      (url, attempt) => (url.endsWith("/robots.txt") ? status(404) : attempt === 0 ? "hang" : ok("late")),
      { minIntervalMs: 0, timeoutMs: 5 },
    );
    await expect(client.get("https://shop.example.test/x")).resolves.toMatchObject({ text: "late" });
    expect(pageCalls()).toHaveLength(2);
  });

  it("gives up with HttpRequestError when every attempt times out", async () => {
    const { client, pageCalls } = harness((url) => (url.endsWith("/robots.txt") ? status(404) : "hang"), {
      minIntervalMs: 0,
      timeoutMs: 5,
      maxRetries: 1,
    });
    await expect(client.get("https://shop.example.test/x")).rejects.toBeInstanceOf(HttpRequestError);
    expect(pageCalls()).toHaveLength(2);
  });

  it("follows a redirect by hand and checks the target against its own host's robots.txt", async () => {
    const { client, calls } = harness((url) => {
      if (url === "https://shop.test/robots.txt") return new Response("User-agent: *\nAllow: /");
      if (url === "https://other.test/robots.txt") return new Response("User-agent: *\nDisallow: /private");
      if (url === "https://shop.test/old") return new Response("", { status: 301, headers: { Location: "/new" } });
      if (url === "https://shop.test/new") return new Response("moved here");
      if (url === "https://shop.test/away")
        return new Response("", {
          status: 302,
          headers: { Location: "https://other.test/private/x" },
        });
      return new Response("should never be fetched");
    });

    await expect(client.get("https://shop.test/old")).resolves.toEqual({
      status: 200,
      url: "https://shop.test/new",
      text: "moved here",
    });
    expect(calls.every((call) => call.init.redirect === "manual")).toBe(true);

    await expect(client.get("https://shop.test/away")).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(calls.map((call) => call.url)).not.toContain("https://other.test/private/x");
  });

  it("gives up on a redirect loop or a redirect without a target", async () => {
    const { client, calls } = harness((url) => {
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url === "https://shop.test/nowhere") return new Response("", { status: 302 });
      return new Response("", { status: 302, headers: { Location: "/loop" } });
    });
    await expect(client.get("https://shop.test/loop")).rejects.toMatchObject({
      name: "HttpRequestError",
      status: 302,
    });
    expect(calls.filter((call) => call.url === "https://shop.test/loop")).toHaveLength(6);
    await expect(client.get("https://shop.test/nowhere")).rejects.toMatchObject({
      name: "HttpRequestError",
      status: 302,
    });
  });

  it("reads a redirected robots.txt and applies it to the host that was asked", async () => {
    const { client } = harness((url) => {
      if (url === "https://shop.test/robots.txt")
        return new Response("", {
          status: 301,
          headers: { Location: "https://www.shop.test/robots.txt" },
        });
      if (url === "https://www.shop.test/robots.txt") return new Response("User-agent: *\nDisallow: /geheim");
      return new Response("page");
    });
    await expect(client.get("https://shop.test/geheim")).rejects.toBeInstanceOf(RobotsDisallowedError);
    await expect(client.get("https://shop.test/aanbiedingen")).resolves.toMatchObject({ text: "page" });
  });

  it("refuses URLs that are not http or https", async () => {
    const { client, calls } = harness(OPEN);
    await expect(client.get("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(client.get("not a url")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("createOfflineHttpClient", () => {
  it("refuses every request", async () => {
    await expect(createOfflineHttpClient().get("https://shop.example.test/")).rejects.toThrow(/offline/);
  });
});
