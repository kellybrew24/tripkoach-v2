export interface PasswordRule { label: string; met: boolean }
export interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  /** Live checklist. TripKoach default: at least 8 characters, one letter, one number. */
  rules?: PasswordRule[];
}
export declare function PasswordInput(props: PasswordInputProps): JSX.Element;
