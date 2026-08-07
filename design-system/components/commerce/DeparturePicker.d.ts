export interface Departure {
  id: string;
  /** Pre-formatted date, e.g. "Sat 12 Sep 2026". Never a raw ISO string. */
  date: string;
  /** Start time and meeting note, e.g. "06:30 · Accra pickup". */
  time: string;
  price: number;
  spotsLeft: number;
  guide?: string;
}
export interface DeparturePickerProps {
  departures: Departure[];
  /** Selected departure id. */
  value?: string;
  onChange?: (id: string) => void;
  currency?: "GHS" | "USD";
  legend?: string;
}
export declare function DeparturePicker(props: DeparturePickerProps): JSX.Element;
