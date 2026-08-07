export interface LogoProps {
  /** Badge size in px. Minimum 28; below that the lettering in the badge closes up. */
  size?: number;
  /** Show the "TripKoach" wordmark next to the badge. Hide it in tight mobile headers. */
  wordmark?: boolean;
  /** "inverse" for dark backgrounds (footer). */
  tone?: "ink" | "inverse";
  /** Path to the badge asset, relative to the consuming page. */
  src?: string;
  href?: string;
}
export declare function Logo(props: LogoProps): JSX.Element;
