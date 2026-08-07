export interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked?: boolean;
}
export declare function Switch(props: SwitchProps): JSX.Element;
