export interface BottomNavItem { id: string; label: string; icon: string; badge?: number }
export interface BottomNavProps {
  /** 3–5 items. More than five and the labels truncate on a 360px screen. */
  items: BottomNavItem[];
  current?: string;
  onSelect?: (id: string) => void;
}
export declare function BottomNav(props: BottomNavProps): JSX.Element;
