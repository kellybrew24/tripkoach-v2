export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide icon name. */
  icon: string;
  /** Required accessible name — an icon-only control is invisible to screen readers without it. */
  label: string;
  variant?: "ghost" | "outline" | "solid";
  disabled?: boolean;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
