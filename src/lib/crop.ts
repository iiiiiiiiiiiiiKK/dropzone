export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { width: number; height: number };

/** Smallest selectable region, in source pixels. */
export const MIN_CROP = 8;

/**
 * Maps a rectangle dragged inside a letterboxed stage back to source-image pixels.
 * `stage` is the on-screen box, `image` the natural size of the capture.
 */
export function stageRectToImage(area: Rect, stage: Size, image: Size): Rect | null {
  if (stage.width <= 0 || stage.height <= 0) return null;
  if (image.width <= 0 || image.height <= 0) return null;
  const scale = Math.min(stage.width / image.width, stage.height / image.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const offsetX = (stage.width - image.width * scale) / 2;
  const offsetY = (stage.height - image.height * scale) / 2;
  const x = (area.x - offsetX) / scale;
  const y = (area.y - offsetY) / scale;
  const w = area.w / scale;
  const h = area.h / scale;
  const left = Math.max(0, Math.min(x, image.width - 1));
  const top = Math.max(0, Math.min(y, image.height - 1));
  const width = Math.min(Math.max(0, w), image.width - left);
  const height = Math.min(Math.max(0, h), image.height - top);
  if (width < MIN_CROP || height < MIN_CROP) return null;
  return { x: Math.round(left), y: Math.round(top), w: Math.round(width), h: Math.round(height) };
}

/** Clamps a drag to the stage box, keeping the rectangle axis-aligned. */
export function dragToRect(start: { x: number; y: number }, end: { x: number; y: number }, stage: Size): Rect {
  const clampX = (value: number) => Math.min(Math.max(value, 0), stage.width);
  const clampY = (value: number) => Math.min(Math.max(value, 0), stage.height);
  const x1 = clampX(start.x);
  const y1 = clampY(start.y);
  const x2 = clampX(end.x);
  const y2 = clampY(end.y);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}
