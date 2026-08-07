export interface FieldError { id: string; message: string }
export interface ErrorSummaryProps {
  title?: string;
  /** Each entry links to the offending field by id. Receives focus when it appears. */
  errors: FieldError[];
}
export declare function ErrorSummary(props: ErrorSummaryProps): JSX.Element | null;
