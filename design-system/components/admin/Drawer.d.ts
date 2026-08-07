export interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose?: () => void;
  /** Sticky footer — typically Cancel + Save buttons. */
  footer?: React.ReactNode;
  width?: string | number;
  children?: React.ReactNode;
}
export declare function Drawer(props: DrawerProps): JSX.Element | null;
