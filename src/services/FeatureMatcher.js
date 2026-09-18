const DEFAULT_MATCHER_CONFIG = Object.freeze({
  ratioThreshold: 0.75
});

export class FeatureMatcher {
  constructor(cv, config = {}) {
    this.cv = cv;
    this.config = {
      ...DEFAULT_MATCHER_CONFIG,
      ...config
    };
  }

  getConfig() {
    return { ...this.config };
  }

  match(sourceFeatures, targetFeatures, label = 'unknown pair') {
    this._validateRuntime();
    this._validateFeatureResult(sourceFeatures, 'source');
    this._validateFeatureResult(targetFeatures, 'target');

    if (sourceFeatures.descriptors.cols !== targetFeatures.descriptors.cols) {
      throw new Error('Source and target descriptors have incompatible dimensions.');
    }

    if (sourceFeatures.descriptors.type() !== targetFeatures.descriptors.type()) {
      throw new Error('Source and target descriptors have incompatible types.');
    }

    const matcher = this._createMatcher();
    let knnMatches;

    try {
      console.log('[GEOMETRY] Feature matching started', {
        pair: label,
        sourceDescriptor: this._descriptorSummary(sourceFeatures.descriptors),
        targetDescriptor: this._descriptorSummary(targetFeatures.descriptors),
        ratioThreshold: this.config.ratioThreshold
      });
      knnMatches = new this.cv.DMatchVectorVector();
      matcher.knnMatch(sourceFeatures.descriptors, targetFeatures.descriptors, knnMatches, 2);

      const matches = [];
      const candidateCount = typeof knnMatches.size === 'function' ? knnMatches.size() : 0;

      for (let index = 0; index < candidateCount; index += 1) {
        const candidates = knnMatches.get(index);
        const matchCount = typeof candidates?.size === 'function' ? candidates.size() : 0;

        if (matchCount < 2) {
          continue;
        }

        const bestMatch = candidates.get(0);
        const secondBestMatch = candidates.get(1);

        if (bestMatch.distance < this.config.ratioThreshold * secondBestMatch.distance) {
          matches.push({
            queryIdx: bestMatch.queryIdx,
            trainIdx: bestMatch.trainIdx,
            distance: bestMatch.distance
          });
        }
      }

      console.log('[GEOMETRY] Feature matching result', {
        pair: label,
        totalKnnMatches: candidateCount,
        matchesAfterLoweRatio: matches.length,
        ratioThreshold: this.config.ratioThreshold
      });

      return {
        matches,
        matchCount: matches.length,
        sourceKeypointCount: sourceFeatures.keypointCount,
        targetKeypointCount: targetFeatures.keypointCount,
        ratioThreshold: this.config.ratioThreshold
      };
    } catch (error) {
      console.warn('Feature matching failed:', error);
      throw new Error('Feature matching failed.');
    } finally {
      if (knnMatches && typeof knnMatches.delete === 'function') {
        knnMatches.delete();
      }

      if (typeof matcher.delete === 'function') {
        matcher.delete();
      }
    }
  }

  _validateRuntime() {
    if (!this.cv) {
      throw new Error('OpenCV is not initialized.');
    }

    if (typeof this.cv.BFMatcher !== 'function' || typeof this.cv.DMatchVectorVector !== 'function') {
      throw new Error('OpenCV feature matching is unavailable.');
    }
  }

  _validateFeatureResult(features, label) {
    if (!features || !features.keypoints || !features.descriptors) {
      throw new Error(`No usable ${label} features were provided.`);
    }

    const { descriptors, keypointCount } = features;
    const hasDescriptorShape = descriptors.rows > 0 && descriptors.cols > 0;
    const hasKeypoints = Number.isInteger(keypointCount) && keypointCount > 0;

    if (!hasDescriptorShape || !hasKeypoints || typeof descriptors.type !== 'function') {
      throw new Error(`The ${label} feature descriptors are empty or unusable.`);
    }

    if (this.cv.CV_8U !== undefined && descriptors.type() !== this.cv.CV_8U) {
      throw new Error(`The ${label} descriptors are not compatible with ORB matching.`);
    }
  }

  _createMatcher() {
    try {
      if (this.cv.NORM_HAMMING === undefined) {
        throw new Error('Hamming distance is unavailable.');
      }

      return new this.cv.BFMatcher(this.cv.NORM_HAMMING, false);
    } catch (error) {
      console.warn('Feature matcher initialization failed:', error);
      throw new Error('Unable to initialize the feature matcher.');
    }
  }

  _descriptorSummary(descriptors) {
    return {
      rows: descriptors.rows,
      cols: descriptors.cols,
      type: descriptors.type(),
      channels: typeof descriptors.channels === 'function' ? descriptors.channels() : 'unknown'
    };
  }
}

export default FeatureMatcher;