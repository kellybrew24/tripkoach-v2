export interface Tab { id: string; label: string; count?: number }
export interface TabsProps {
  tabs: Tab[];
  value?: string;
  onChange?: (id: string) => void;
  /** Prefix for tab/panel ids so several tab sets can coexist. */
  idPrefix?: string;
}
export declare function Tabs(props: TabsProps): JSX.Element;
