export interface AccordionItem { id: string; title: string; content: React.ReactNode }
export interface AccordionProps {
  items: AccordionItem[];
  /** ids open on first render — open the first itinerary day by default. */
  defaultOpen?: string[];
}
export declare function Accordion(props: AccordionProps): JSX.Element;
