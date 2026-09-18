const DEFAULT_HOMOGRAPHY_CONFIG = Object.freeze({
  method: 'RANSAC',
  ransacReprojThreshold: 3.0,
  maxIters: 2000,
  confidence: 0.995
});

export class HomographyEstimator {
  constructor(cv, config = {}) {
    this.cv = cv;
    this.config = {
      ...DEFAULT_HOMOGRAPHY_CONFIG,
      ...config
    };
  }

  getConfig() {
    return { ...this.config };
  }

  estimate(sourceFeatures, targetFeatures, matchResult, label = 'unknown pair', diagnostic = null) {
    if (!this.cv || typeof this.cv.findHomography !== 'function') {
      return { success: false, reason: 'OPENCV_UNAVAILABLE' };
    }

    const matches = Array.isArray(matchResult?.matches) ? matchResult.matches : [];
    if (matches.length < 4) {
      return { success: false, reason: 'INSUFFICIENT_MATCHES', matchCount: matches.length };
    }

    const sourcePoints = [];
    const targetPoints = [];

    for (const match of matches) {
      const sourcePoint = this._getKeypointCoordinates(sourceFeatures, match?.queryIdx);
      const targetPoint = this._getKeypointCoordinates(targetFeatures, match?.trainIdx);

      if (!sourcePoint || !targetPoint) {
        return { success: false, reason: 'INVALID_CORRESPONDENCES', matchCount: matches.length };
      }

      sourcePoints.push(sourcePoint.x, sourcePoint.y);
      targetPoints.push(targetPoint.x, targetPoint.y);
    }

    console.log('[GEOMETRY] Homography input', {
      pair: label,
      correspondences: matches.length,
      sourcePoints,
      targetPoints,
      ransacReprojThreshold: this.config.ransacReprojThreshold,
      maxIters: this.config.maxIters,
      confidence: this.config.confidence
    });

    let sourcePointMat;
    let targetPointMat;
    let homographyMat;
    let inlierMask;

    try {
      if (this.cv.CV_32FC2 === undefined || typeof this.cv.Mat !== 'function') {
        return { success: false, reason: 'OPENCV_UNAVAILABLE' };
      }

      sourcePointMat = new this.cv.Mat(sourcePoints.length / 2, 1, this.cv.CV_32FC2);
      targetPointMat = new this.cv.Mat(targetPoints.length / 2, 1, this.cv.CV_32FC2);
      sourcePointMat.data32F.set(sourcePoints);
      targetPointMat.data32F.set(targetPoints);
      inlierMask = new this.cv.Mat();

      homographyMat = this.cv.findHomography(
        sourcePointMat,
        targetPointMat,
        this.config.method === 'RANSAC' ? this.cv.RANSAC : this.config.method,
        this.config.ransacReprojThreshold,
        inlierMask,
        this.config.maxIters,
        this.config.confidence
      );

      if (!homographyMat || homographyMat.empty?.()) {
        return { success: false, reason: 'ESTIMATION_FAILED', matchCount: matches.length };
      }

      const homography = this._readHomography(homographyMat);
      if (!homography) {
        return { success: false, reason: 'ESTIMATION_FAILED', matchCount: matches.length };
      }

      const inlierCount = this._countInliers(inlierMask, matches.length);
      const determinant = this._determinant(homography);
      console.log('[GEOMETRY] Homography matrix', JSON.stringify({
        pair: label,
        direction: 'source -> target',
        matrix: homography,
        determinant
      }));
      console.log('[GEOMETRY] Homography result', {
        pair: label,
        direction: 'source -> target',
        matrix: homography,
        determinant,
        containsNaN: homography.flat().some((value) => Number.isNaN(value)),
        containsInfinity: homography.flat().some((value) => !Number.isFinite(value)),
        totalCorrespondences: matches.length,
        inlierCount,
        outlierCount: matches.length - inlierCount,
        inlierPercentage: (inlierCount / matches.length) * 100,
        transformedSourceCorners: this._transformCorners(homography, sourceFeatures.width, sourceFeatures.height)
      });
      diagnostic?.log('HOMOGRAPHY', {
        pair: label,
        direction: 'source -> target',
        correspondenceCount: matches.length,
        inlierCount,
        outlierCount: matches.length - inlierCount,
        inlierPercentage: (inlierCount / matches.length) * 100,
        H: homography,
        determinant,
        hasNaN: homography.flat().some((value) => Number.isNaN(value)),
        hasInfinity: homography.flat().some((value) => !Number.isFinite(value)),
        transformedCorners: this._transformCorners(homography, sourceFeatures.width, sourceFeatures.height)
      });
      return {
        success: true,
        homography,
        matchCount: matches.length,
        inlierCount,
        inlierRatio: inlierCount / matches.length,
        sourceWidth: sourceFeatures?.width,
        sourceHeight: sourceFeatures?.height,
        targetWidth: targetFeatures?.width,
        targetHeight: targetFeatures?.height
      };
    } catch (error) {
      console.warn('Homography estimation failed:', error);
      return { success: false, reason: 'ESTIMATION_FAILED', matchCount: matches.length };
    } finally {
      sourcePointMat?.delete?.();
      targetPointMat?.delete?.();
      homographyMat?.delete?.();
      inlierMask?.delete?.();
    }
  }

  _getKeypointCoordinates(features, index) {
    if (!features?.keypoints || !Number.isInteger(index) || index < 0) {
      return null;
    }

    const keypointCount = typeof features.keypoints.size === 'function'
      ? features.keypoints.size()
      : features.keypointCount;

    if (!Number.isInteger(keypointCount) || index >= keypointCount) {
      return null;
    }

    try {
      const keypoint = features.keypoints.get?.(index);
      const point = keypoint?.pt ?? keypoint;
      const x = Number(point?.x);
      const y = Number(point?.y);

      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch {
      return null;
    }
  }

  _readHomography(homographyMat) {
    if (homographyMat.rows !== 3 || homographyMat.cols !== 3 || typeof homographyMat.doubleAt !== 'function') {
      return null;
    }

    const values = [];
    for (let row = 0; row < 3; row += 1) {
      const matrixRow = [];
      for (let column = 0; column < 3; column += 1) {
        const value = homographyMat.doubleAt(row, column);
        if (!Number.isFinite(value)) {
          return null;
        }
        matrixRow.push(value);
      }
      values.push(matrixRow);
    }

    return values;
  }

  _countInliers(mask, matchCount) {
    if (!mask || typeof mask.ucharAt !== 'function') {
      return 0;
    }

    let inlierCount = 0;
    for (let index = 0; index < matchCount; index += 1) {
      if (mask.ucharAt(index, 0) !== 0) {
        inlierCount += 1;
      }
    }
    return inlierCount;
  }

  _determinant(matrix) {
    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  }

  _transformCorners(matrix, width, height) {
    return [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => {
      const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
      return {
        input: [x, y],
        output: [
          (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
          (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
        ]
      };
    });
  }
}

export default HomographyEstimator;
