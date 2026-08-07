export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Pressed state — used for active filters. */
  active?: boolean;
  /** Renders the dismiss affordance; the whole chip removes the filter. */
  onRemove?: () => void;
  children: React.ReactNode;
}
export declare function Chip(props: ChipProps): JSX.Element;
