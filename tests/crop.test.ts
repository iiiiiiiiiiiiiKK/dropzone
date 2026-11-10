import { describe, expect, it } from 'vitest';
import { MIN_CROP, dragToRect, stageRectToImage } from '../src/lib/crop';

const stage = { width: 800, height: 450 };
const image = { width: 1600, height: 900 }; // same 16:9 → scale 0.5, no letterbox

describe('stageRectToImage', () => {
  it('maps a full-stage selection to the whole image', () => {
    expect(stageRectToImage({ x: 0, y: 0, w: 800, h: 450 }, stage, image)).toEqual({ x: 0, y: 0, w: 1600, h: 900 });
  });

  it('scales a centred selection by the letterbox factor', () => {
    expect(stageRectToImage({ x: 200, y: 100, w: 400, h: 200 }, stage, image)).toEqual({ x: 400, y: 200, w: 800, h: 400 });
  });

  it('ignores letterbox padding when the image is narrower than the stage', () => {
    const wideStage = { width: 800, height: 450 };
    const narrowImage = { width: 400, height: 450 }; // scale 1, 200 px of padding on each side
    expect(stageRectToImage({ x: 300, y: 50, w: 200, h: 100 }, wideStage, narrowImage)).toEqual({ x: 100, y: 50, w: 200, h: 100 });
  });

  it('subtracts letterbox padding before scaling', () => {
    // 400×400 in an 800×450 stage: scale 1.125, horizontal padding 175 px.
    expect(stageRectToImage({ x: 300, y: 50, w: 200, h: 100 }, stage, { width: 400, height: 400 })).toEqual({
      x: 111,
      y: 44,
      w: 178,
      h: 89,
    });
  });

  it('clamps a selection that starts before the image', () => {
    const tallImage = { width: 400, height: 400 };
    const result = stageRectToImage({ x: 0, y: 0, w: 300, h: 300 }, { width: 800, height: 450 }, tallImage);
    expect(result?.x).toBe(0);
    expect(result?.y).toBe(0);
  });

  it('rejects selections smaller than the minimum in source pixels', () => {
    // scale 0.5 → a 2×2 px drag is only 4×4 source pixels.
    expect(stageRectToImage({ x: 10, y: 10, w: 2, h: 2 }, stage, image)).toBeNull();
    expect(stageRectToImage({ x: 10, y: 10, w: MIN_CROP, h: MIN_CROP }, stage, image)).not.toBeNull();
  });

  it('rejects an empty stage', () => {
    expect(stageRectToImage({ x: 10, y: 10, w: 40, h: 40 }, { width: 0, height: 0 }, image)).toBeNull();
  });
});

describe('dragToRect', () => {
  it('normalises a drag in any direction', () => {
    expect(dragToRect({ x: 400, y: 300 }, { x: 100, y: 100 }, stage)).toEqual({ x: 100, y: 100, w: 300, h: 200 });
  });

  it('clamps outside the stage', () => {
    expect(dragToRect({ x: -50, y: -50 }, { x: 900, y: 900 }, stage)).toEqual({ x: 0, y: 0, w: 800, h: 450 });
  });
});
