/**
 * @startingPoint section="Actions" subtitle="Button variants, sizes and states" viewport="700x300"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = ink, the one decisive action per view. accent = Kente gold, reserved for booking CTAs. */
  variant?: "primary" | "secondary" | "ghost" | "accent" | "danger" | "link";
  /** sm 36px · md 48px (default) · lg 56px. Never below 44px for a standalone tap target. */
  size?: "sm" | "md" | "lg";
  /** Full-width. The default on mobile for any form-submitting or checkout action. */
  block?: boolean;
  /** Swaps the label for a spinner and blocks input; keeps the button's width. */
  loading?: boolean;
  disabled?: boolean;
  /** Lucide icon name rendered before the label. */
  iconStart?: string;
  /** Lucide icon name rendered after the label. */
  iconEnd?: string;
  as?: "button" | "a";
  href?: string;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
