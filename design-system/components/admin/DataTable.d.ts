export interface Column<T = any> {
  key: string;
  header: React.ReactNode;
  /** Cell renderer; defaults to row[key]. Return a StatusBadge, Price, etc. */
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
  /** Bold + strong text colour — use for the primary identifier column. */
  strong?: boolean;
  width?: string | number;
}
export interface DataTableProps<T = any> {
  columns: Column<T>[];
  rows: T[];
  getRowId?: (row: T) => string;
  /** "compact" tightens row height for dense inventory work. */
  density?: "default" | "compact";
  zebra?: boolean;
  sort?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (s: { key: string; dir: "asc" | "desc" }) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** Per-row trailing cell — typically a kebab menu button. */
  rowActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered when rows is empty and not loading — pass an EmptyState. */
  empty?: React.ReactNode;
}
export declare function DataTable<T = any>(props: DataTableProps<T>): JSX.Element;
