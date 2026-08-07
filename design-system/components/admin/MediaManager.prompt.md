Gallery manager for a tour: drag-drop upload zone plus a tile grid with reorder, set-cover, remove, and per-tile upload progress / error. The cover tile drives the customer card image.

```jsx
<MediaManager items={media} coverId={cover} onUpload={handleFiles}
  onSetCover={setCover} onRemove={removeImg} onReorder={move} />
```

Removal should be confirmed by the caller (Modal) when the image is the cover or the only image.
