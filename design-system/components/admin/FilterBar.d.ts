export interface Facet { id: string; label: string; icon?: string; count?: number; active?: boolean; onClick?: () => void }
export interface AppliedFilter { id: string; label: string; onRemove: () => void }
export interface FilterBarProps {
  facets?: Facet[];
  /** Applied-filter chips shown on the right, each removable. */
  applied?: AppliedFilter[];
  onClear?: () => void;
  /** Extra controls — a search field, a date-range picker, a density toggle. */
  children?: React.ReactNode;
}
export declare function FilterBar(props: FilterBarProps): JSX.Element;
