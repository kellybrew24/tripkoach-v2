export interface NavItemDef { id: string; label: string; icon: string; badge?: number }
export interface NavGroupDef { label?: string; items: NavItemDef[] }
export interface AppShellProps {
  groups: NavGroupDef[];
  current?: string;
  onNavigate?: (id: string) => void;
  user?: { name: string; role: string; initials: string };
  notifications?: number;
  brand?: string;
  logoSrc?: string;
  /** Extra controls slotted into the top bar (e.g. an environment switch). */
  topbarExtra?: React.ReactNode;
  children?: React.ReactNode;
}
export declare function AppShell(props: AppShellProps): JSX.Element;
export declare function SideNav(props: any): JSX.Element;
export declare function TopBar(props: any): JSX.Element;
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; onClick?: () => void }>;
  actions?: React.ReactNode;
}
export declare function PageHeader(props: PageHeaderProps): JSX.Element;
