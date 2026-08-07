export interface PaginationProps {
  page?: number;
  pages?: number;
  onChange?: (page: number) => void;
  /** e.g. "Showing 1–12 of 48 tours" — announced politely when it changes. */
  resultsLabel?: string;
}
export declare function Pagination(props: PaginationProps): JSX.Element;
