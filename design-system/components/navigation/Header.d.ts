export interface NavItem { label: string; href: string }
export interface HeaderProps {
  items?: NavItem[];
  /** href of the active item. */
  current?: string;
  signedIn?: boolean;
  onMenu?: () => void;
  /** Path to the badge asset from the consuming page. */
  logoSrc?: string;
  /** Mobile mode: hamburger + badge only. */
  compact?: boolean;
  /** Extra slot before the account controls, e.g. CurrencyToggle. */
  right?: React.ReactNode;
}
export declare function Header(props: HeaderProps): JSX.Element;
