export interface SearchFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id?: string;
  value?: string;
  onClear?: () => void;
  placeholder?: string;
}
export declare function SearchField(props: SearchFieldProps): JSX.Element;
