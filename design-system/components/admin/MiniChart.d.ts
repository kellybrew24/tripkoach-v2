export interface ChartDatum { label: string; value: number }
export interface MiniChartProps {
  type?: "line" | "bar" | "donut";
  data: ChartDatum[];
  height?: number;
  /** Required for accessibility — describe the trend in words. */
  ariaLabel?: string;
}
export declare function MiniChart(props: MiniChartProps): JSX.Element;
