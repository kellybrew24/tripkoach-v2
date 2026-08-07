export interface FooterColumn { title: string; links: Array<{ label: string; href: string }> }
export interface FooterProps {
  columns?: FooterColumn[];
  logoSrc?: string;
  /** Legal line; always states the charging currency. */
  note?: string;
}
export declare function Footer(props: FooterProps): JSX.Element;
