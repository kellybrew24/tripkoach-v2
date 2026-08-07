export interface RatingProps {
  /** Mean score out of 5, one decimal. */
  value: number;
  /** Number of reviews. Hide the whole component below 3 reviews rather than showing a thin average. */
  count?: number;
  size?: number;
}
export declare function Rating(props: RatingProps): JSX.Element;
