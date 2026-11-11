import { describe, expect, it } from "vitest";
import { locales, plannedLocales, routing, textDirection } from "./routing";

describe("i18n routing", () => {
  it("uses Dutch as the default locale", () => {
    expect(routing.defaultLocale).toBe("nl");
  });

  it("routes Dutch, English and Italian", () => {
    expect([...locales]).toEqual(["nl", "en", "it"]);
  });

  it("does not route planned locales yet", () => {
    for (const planned of plannedLocales) {
      expect(locales as readonly string[]).not.toContain(planned);
    }
  });

  it("renders Arabic right to left and everything else left to right", () => {
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("nl")).toBe("ltr");
    expect(textDirection("unknown")).toBe("ltr");
  });
});
