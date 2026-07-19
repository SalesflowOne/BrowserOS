/**
 * OWeb Browser — shared config for the BrowserOS agent fork overlay.
 * Copy into packages/browseros-agent/apps/app/lib/oweb-config.ts
 */
export const OWEB_APP_ORIGIN =
  import.meta.env.VITE_OWEB_APP_ORIGIN?.trim() || "https://oweb.one";

export const OWEB_API_BASE =
  import.meta.env.VITE_OWEB_API_BASE?.trim() || `${OWEB_APP_ORIGIN}/api/browser/v1`;

export const OWEB_AUTH_PATH = "/auth/browser";

export const OWEB_DEFAULT_MODEL = "google/gemini-2.5-flash";

export const OWEB_PRODUCT_NAME = "OWeb Browser";

export const OWEB_ACCENT = "#22D3EE";

export const OWEB_HIDE_BYOK = import.meta.env.VITE_HIDE_BYOK !== "false";
