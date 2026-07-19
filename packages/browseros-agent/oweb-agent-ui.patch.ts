/**
 * Apply these changes in the BrowserOS fork under packages/browseros-agent/apps/app/
 *
 * 1. styles/global.css — replace BrowserOS orange accent with OWeb cyan:
 *
 *    --accent-orange: oklch(0.78 0.14 195);        /* ~#22D3EE */
 *    --accent-orange-bright: oklch(0.85 0.16 195);
 *
 * 2. components/sidebar/SidebarBranding.tsx — swap logo import:
 *
 *    import ProductLogo from '@/assets/oweb/product_logo.svg'
 *    // alt="OWeb Browser"
 *
 * 3. screens/newtab/index/NewTabBranding.tsx — same logo + alt text
 *
 * 4. Copy browser/branding/*.svg → apps/app/assets/oweb/
 *
 * 5. Onboarding copy: replace "BrowserOS" with "OWeb Browser" in locale strings
 *    under apps/app/locales/en/
 *
 * 6. Default provider in settings: pre-select OWeb, hide BYOK when VITE_HIDE_BYOK=true
 */

export const OWEB_BROWSER_AGENT_PATCHES = {
  accentColor: "#22D3EE",
  productName: "OWeb Browser",
  companyName: "OWeb",
} as const;
