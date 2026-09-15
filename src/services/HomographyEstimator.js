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

  estimate(sourceFeatures, targetFeatures, matchResult) {
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
}

export default HomographyEstimator;
