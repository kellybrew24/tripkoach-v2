export interface BookingRowProps {
  reference: string;
  title: string;
  /** Departure date, pre-formatted. */
  date: string;
  /** e.g. "4 travellers". */
  travellers: string;
  total: number;
  currency?: "GHS" | "USD";
  status: "pending" | "confirmed" | "cancelled";
  image?: string;
  onClick?: () => void;
}
export declare function BookingRow(props: BookingRowProps): JSX.Element;
