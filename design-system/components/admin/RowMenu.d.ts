export interface RowMenuItem { label?: string; icon?: string; onClick?: () => void; danger?: boolean; divider?: boolean }
export interface RowMenuProps {
  items: RowMenuItem[];
  label?: string;
  align?: "start" | "end";
}
export declare function RowMenu(props: RowMenuProps): JSX.Element;
