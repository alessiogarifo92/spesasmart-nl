/**
 * robots.txt parsing and matching (RFC 9309). Pure: the HTTP client fetches the
 * file and asks `isAllowed` before every request.
 */

export type RobotsRule = { allow: boolean; pattern: string };

export type RobotsGroup = {
  /** Lower-cased user-agent values the group applies to. */
  agents: string[];
  rules: RobotsRule[];
};

export type RobotsRules = { groups: RobotsGroup[] };

/** Parses a robots.txt body. Unknown directives (Sitemap, Crawl-delay) are ignored. */
export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (directive === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (directive !== "allow" && directive !== "disallow")) continue;
    // An empty path matches nothing: "Disallow:" allows everything.
    if (value === "") continue;
    current.rules.push({ allow: directive === "allow", pattern: value });
  }
  return { groups };
}

/** Rules of the most specific group whose user-agent prefixes the token, else of `*`. */
function rulesFor(robots: RobotsRules, userAgentToken: string): RobotsRule[] {
  const token = userAgentToken.toLowerCase();
  let bestLength = 0;
  let best: RobotsRule[] = [];
  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === "*" || !token.startsWith(agent)) continue;
      if (agent.length > bestLength) {
        bestLength = agent.length;
        best = [...group.rules];
      } else if (agent.length === bestLength) {
        best.push(...group.rules);
      }
    }
  }
  if (bestLength > 0) return best;
  return robots.groups.filter((group) => group.agents.includes("*")).flatMap((group) => group.rules);
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

/**
 * True when the crawler named `userAgentToken` may fetch `pathWithQuery`. The longest
 * matching pattern wins; Allow wins a tie; no matching rule means allowed.
 */
export function isAllowed(robots: RobotsRules, userAgentToken: string, pathWithQuery: string): boolean {
  if (pathWithQuery === "/robots.txt") return true;
  let winner: RobotsRule | null = null;
  for (const rule of rulesFor(robots, userAgentToken)) {
    if (!patternToRegex(rule.pattern).test(pathWithQuery)) continue;
    if (
      !winner ||
      rule.pattern.length > winner.pattern.length ||
      (rule.pattern.length === winner.pattern.length && rule.allow)
    ) {
      winner = rule;
    }
  }
  return winner === null || winner.allow;
}
