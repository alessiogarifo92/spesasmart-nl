export const THEME_STORAGE_KEY = "spesasmart-theme";
export const themes = ["system", "dark", "light"] as const;
export type Theme = (typeof themes)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}

/**
 * Runs before first paint (inlined in the document head) so a chosen theme
 * never flashes. "system" leaves the attribute off and CSS follows the device.
 */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;
