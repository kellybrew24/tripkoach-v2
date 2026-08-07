export interface MediaItem { id: string; src: string; alt?: string; progress?: number; error?: boolean }
export interface MediaManagerProps {
  items: MediaItem[];
  coverId?: string;
  onSetCover?: (id: string) => void;
  onRemove?: (id: string) => void;
  onReorder?: (from: number, to: number) => void;
  onUpload?: (files: FileList) => void;
}
export declare function MediaManager(props: MediaManagerProps): JSX.Element;
