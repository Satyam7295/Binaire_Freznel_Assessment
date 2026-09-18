import assert from 'node:assert/strict';
import test from 'node:test';
import FeatureMatcher from '../src/services/FeatureMatcher.js';

class FakeDescriptors {
  constructor(rows = 8, cols = 32, type = 0) {
    this.rows = rows;
    this.cols = cols;
    this._type = type;
  }

  type() {
    return this._type;
  }
}

function createFeatureResult(points) {
  return {
    keypoints: {
      size: () => points.length,
      get: (index) => ({ pt: points[index] })
    },
    descriptors: new FakeDescriptors(points.length),
    keypointCount: points.length,
    width: 1280,
    height: 1280
  };
}

function createCv(knnRows) {
  return {
    CV_8U: 0,
    NORM_HAMMING: 6,
    BFMatcher: class {
      knnMatch(source, target, output) {
        output.rows = knnRows;
      }

      delete() {}
    },
    DMatchVectorVector: class {
      size() {
        return this.rows.length;
      }

      get(index) {
        const row = this.rows[index];
        return {
          size: () => row.length,
          get: (matchIndex) => row[matchIndex]
        };
      }

      delete() {}
    }
  };
}

const distributedPoints = [
  { x: 100, y: 100 },
  { x: 1100, y: 120 },
  { x: 1080, y: 1100 },
  { x: 120, y: 1080 },
  { x: 600, y: 620 },
  { x: 800, y: 300 }
];

const distributedFeatures = createFeatureResult(distributedPoints);

test('keeps the strongest deterministic one-to-one descriptor matches', () => {
  const matcher = new FeatureMatcher(createCv([
    [
      { queryIdx: 0, trainIdx: 0, distance: 20 },
      { queryIdx: 0, trainIdx: 1, distance: 30 }
    ],
    [
      { queryIdx: 1, trainIdx: 0, distance: 10 },
      { queryIdx: 1, trainIdx: 2, distance: 40 }
    ],
    [
      { queryIdx: 2, trainIdx: 2, distance: 15 },
      { queryIdx: 2, trainIdx: 3, distance: 40 }
    ],
    [
      { queryIdx: 3, trainIdx: 3, distance: 12 },
      { queryIdx: 3, trainIdx: 4, distance: 40 }
    ],
    [
      { queryIdx: 4, trainIdx: 4, distance: 13 },
      { queryIdx: 4, trainIdx: 5, distance: 40 }
    ],
    [
      { queryIdx: 5, trainIdx: 5, distance: 14 },
      { queryIdx: 5, trainIdx: 0, distance: 40 }
    ]
  ]));

  const result = matcher.match(distributedFeatures, distributedFeatures);

  assert.deepEqual(result.matches.map(({ queryIdx, trainIdx }) => [queryIdx, trainIdx]).sort((left, right) => left[0] - right[0]), [
    [1, 0],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5]
  ].sort((left, right) => left[0] - right[0]));
  assert.equal(result.diagnostics.matchesBeforeDeduplication, 6);
  assert.equal(result.diagnostics.matchesAfterDeduplication, 5);
  assert.equal(result.diagnostics.duplicateTrainCount, 1);
});

test('rejects spatially concentrated correspondences before homography', () => {
  const concentratedPoints = [
    { x: 500, y: 500 },
    { x: 510, y: 505 },
    { x: 520, y: 510 },
    { x: 530, y: 515 },
    { x: 540, y: 520 }
  ];
  const features = createFeatureResult(concentratedPoints);
  const matcher = new FeatureMatcher(createCv(concentratedPoints.map((_, index) => ([
    { queryIdx: index, trainIdx: index, distance: 10 },
    { queryIdx: index, trainIdx: index + 10, distance: 30 }
  ]))));

  assert.throws(
    () => matcher.match(features, features),
    (error) => error.code === 'INSUFFICIENT_SPATIAL_MATCHES'
      && error.message === 'Insufficient spatially distributed feature matches.'
  );
});
