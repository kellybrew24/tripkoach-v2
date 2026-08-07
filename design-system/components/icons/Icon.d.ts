export interface IconProps {
  /** Lucide icon name, kebab-case, e.g. "map-pin". See ICONS for the full set. */
  name: string;
  /** Pixel size, square. Default 20. Use 20 inline, 24 for nav, 16 for dense meta rows. */
  size?: number;
  /** Stroke width. Default 2 — never go below 1.5 or the icon disappears on low-end screens. */
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons (they get aria-hidden). */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): JSX.Element | null;
export declare const ICONS: Record<string, string>;
