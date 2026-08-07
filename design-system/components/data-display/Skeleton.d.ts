export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: string;
  /** More than one renders a paragraph block with a short last line. */
  lines?: number;
  className?: string;
}
export declare function Skeleton(props: SkeletonProps): JSX.Element;
