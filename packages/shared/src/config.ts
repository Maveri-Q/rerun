/**
 * The brand, in one place. Change the name and logo here and the site, its favicon, receipts and
 * command-line output all follow. This doesn't rename testnet accounts, package names or the event
 * standard below, which are identifiers and not branding.
 */
export const APP_NAME = "RERUN";

/** The mark, as the inside of a 24 by 24 SVG. `currentColor` takes the surrounding text colour. */
export const APP_LOGO_SVG = '<circle cx="12" cy="12" r="7" fill="#b4f4cc"/>';

/** The same mark as a whole image, for the favicon. */
export const appLogoFile = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${APP_LOGO_SVG}</svg>`;

/** NEP-297 event standard name emitted by the contract. Part of the on-chain format, so not branding. */
export const EVENT_STANDARD = "rerun";
