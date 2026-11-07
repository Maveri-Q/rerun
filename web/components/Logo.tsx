import { APP_LOGO_SVG } from "@rerun/shared/browser";

/** The mark from the brand config, inline so it stays sharp. */
export function Logo({ size = 16 }: { size?: number }) {
  return <svg viewBox="0 0 240 240" width={size} height={size} aria-hidden="true" dangerouslySetInnerHTML={{ __html: APP_LOGO_SVG }} />;
}
