import assert from 'node:assert/strict';
import test from 'node:test';
import PanoramaBlender from '../src/services/PanoramaBlender.js';

class FakeMat {
  static zeros(rows, cols) {
    return new FakeMat(rows, cols);
  }

  constructor(rows = 0, cols = 0) {
    this.rows = rows;
    this.cols = cols;
    this.data64F = new Float64Array(9);
    this.converted = false;
  }

  convertTo(output) {
    output.converted = true;
  }

  empty() {
    return false;
  }

  delete() {}
}

function createFakeCv() {
  return {
    Mat: FakeMat,
    CV_32FC1: 5,
    CV_32FC4: 6,
    CV_64F: 7,
    CV_8UC1: 0,
    CV_8U: 0,
    warpPerspective() {},
    distanceTransform() {},
    threshold() {},
    merge() {},
    multiply() {},
    add() {},
    divide(accumulation, expandedWeight, normalized) {
      assert.equal(accumulation.rows, 2);
      assert.equal(accumulation.cols, 2);
      assert.equal(expandedWeight.rows, 0);
      normalized.zeroWeightHandled = true;
    },
    imshow() {}
  };
}

test('rejects pathological canvas dimensions before allocation', async () => {
  const blender = new PanoramaBlender(createFakeCv(), { maxCanvasPixels: 100 });
  const result = await blender.blend([{ previewUrl: 'unused' }], {
    success: true,
    width: 11,
    height: 10,
    placements: [{ transform: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }]
  });

  assert.deepEqual(result, { success: false, reason: 'PANORAMA_TOO_LARGE' });
});

test('creates a finite nine-value placement matrix', () => {
  const blender = new PanoramaBlender(createFakeCv());
  const matrix = blender._createMatrixMat([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);

  assert.deepEqual([...matrix.data64F], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('rejects invalid placement values', () => {
  const blender = new PanoramaBlender(createFakeCv());

  assert.throws(
    () => blender._createMatrixMat([[1, 2, 3], [4, Number.NaN, 6], [7, 8, 9]]),
    /INVALID_PLACEMENT/
  );
});

test('keeps zero-weight normalization finite', async () => {
  const blender = new PanoramaBlender(createFakeCv());
  blender._accumulateImage = async () => {};

  globalThis.document = {
    createElement() {
      return { width: 0, height: 0, toDataURL: () => 'data:image/png;base64,test' };
    }
  };

  const result = await blender.blend([{ previewUrl: 'unused' }], {
    success: true,
    width: 2,
    height: 2,
    placements: [{ transform: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }]
  });

  assert.equal(result.success, true);
  assert.match(result.blendedImage, /^data:image\/png/);
  delete globalThis.document;
});