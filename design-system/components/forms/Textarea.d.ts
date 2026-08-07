export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Shows a live character counter under the field. */
  maxLength?: number;
}
export declare function Textarea(props: TextareaProps): JSX.Element;
