export interface DialCode { code: string; dial: string; name: string }
export declare const DIAL_CODES: DialCode[];
export interface PhoneInputProps {
  id: string;
  /** Selected country (2-letter code). Drives the dial code. Defaults to Ghana. */
  country?: string;
  onCountryChange?: (code: string) => void;
  /** Legacy override — pass a raw dial code / flag string to pin them. Prefer `country`. */
  dialCode?: string;
  flag?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
export declare function PhoneInput(props: PhoneInputProps): JSX.Element;
