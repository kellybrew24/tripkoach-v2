/**
 * @startingPoint section="Commerce" subtitle="Tour card, grid and list-row variants" viewport="700x420"
 */
export interface TourCardProps {
  title: string;
  /** Region within Ghana, e.g. "Greater Accra". */
  region: string;
  /** Human duration string, e.g. "Full day, 8 hrs". */
  duration: string;
  image?: string;
  /** Describe the place, not the composition. Empty string if the title already says it. */
  imageAlt?: string;
  /** Lowest per-person price across departures. */
  price: number;
  currency?: "GHS" | "USD";
  approxPrice?: number;
  rating?: number;
  reviewCount?: number;
  /** Remaining spots on the soonest departure; drives the availability badge. */
  spotsLeft?: number;
  /** Editorial tag, e.g. "Best seller". Use sparingly. */
  tag?: string;
  variant?: "grid" | "row";
  href?: string;
}
export declare function TourCard(props: TourCardProps): JSX.Element;
