export interface Crumb { label: string; href?: string }
export interface BreadcrumbsProps {
  /** Last item is the current page and is not a link. Desktop only — hidden below 768px. */
  items: Crumb[];
}
export declare function Breadcrumbs(props: BreadcrumbsProps): JSX.Element;
