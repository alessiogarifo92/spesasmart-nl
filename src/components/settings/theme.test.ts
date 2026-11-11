import { describe, expect, it } from "vitest";
import { isTheme, themeBootScript, THEME_STORAGE_KEY } from "./theme";

describe("theme", () => {
  it("recognises only the three choices", () => {
    expect(isTheme("system")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("sepia")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  function boot(stored: string | null | Error) {
    const documentElement = { dataset: {} as Record<string, string> };
    const localStorage = {
      getItem(key: string) {
        if (stored instanceof Error) throw stored;
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    };
    new Function("localStorage", "document", themeBootScript)(localStorage, { documentElement });
    return documentElement.dataset.theme;
  }

  it("applies a stored explicit theme before paint", () => {
    expect(boot("light")).toBe("light");
    expect(boot("dark")).toBe("dark");
  });

  it("leaves the device preference alone for system, nothing stored or garbage", () => {
    expect(boot("system")).toBeUndefined();
    expect(boot(null)).toBeUndefined();
    expect(boot("<script>")).toBeUndefined();
  });

  it("survives blocked storage", () => {
    expect(boot(new Error("SecurityError"))).toBeUndefined();
  });
});
