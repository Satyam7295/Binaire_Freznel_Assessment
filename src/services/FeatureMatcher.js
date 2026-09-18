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

  match(sourceFeatures, targetFeatures, label = 'unknown pair', diagnostic = null) {
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

      const spatialStatsBeforeDeduplication = this._spatialStats(matches, sourceFeatures, targetFeatures);
      const uniqueMatches = this._deduplicateMatches(matches);
      const spatialStatsAfterDeduplication = this._spatialStats(uniqueMatches, sourceFeatures, targetFeatures);
      const duplicateQueryCount = matches.length - new Set(matches.map((match) => match.queryIdx)).size;
      const duplicateTrainCount = matches.length - new Set(matches.map((match) => match.trainIdx)).size;

      console.log('[GEOMETRY] Feature matching result', {
        pair: label,
        totalKnnMatches: candidateCount,
        matchesAfterLoweRatio: matches.length,
        matchesBeforeDeduplication: matches.length,
        matchesAfterDeduplication: uniqueMatches.length,
        duplicateQueryIdx: duplicateQueryCount,
        duplicateTrainIdx: duplicateTrainCount,
        duplicateTrainIdxRemoved: duplicateTrainCount,
        spatialSpreadBeforeDeduplication: spatialStatsBeforeDeduplication,
        spatialSpreadAfterDeduplication: spatialStatsAfterDeduplication,
        ratioThreshold: this.config.ratioThreshold
      });
      diagnostic?.log('FEATURE MATCHING', {
        pair: { imageA: label.split(' to ')[0], imageB: label.split(' to ').slice(1).join(' to ') },
        knnCandidates: candidateCount,
        loweApproved: matches.length,
        duplicateQueryIdx: duplicateQueryCount,
        duplicateTrainIdx: duplicateTrainCount,
        finalMatches: uniqueMatches.length,
        source: spatialStatsAfterDeduplication.source,
        target: spatialStatsAfterDeduplication.target,
        sample: uniqueMatches.slice(0, 10).map((match) => ({
          queryIdx: match.queryIdx,
          trainIdx: match.trainIdx,
          source: this._getKeypointCoordinates(sourceFeatures, match.queryIdx),
          target: this._getKeypointCoordinates(targetFeatures, match.trainIdx),
          distance: match.distance
        }))
      });

      this._validateMatchGeometry(uniqueMatches, spatialStatsAfterDeduplication);

      return {
        matches: uniqueMatches,
        matchCount: uniqueMatches.length,
        sourceKeypointCount: sourceFeatures.keypointCount,
        targetKeypointCount: targetFeatures.keypointCount,
        ratioThreshold: this.config.ratioThreshold,
        diagnostics: {
          candidateCount,
          matchesBeforeDeduplication: matches.length,
          matchesAfterDeduplication: uniqueMatches.length,
          duplicateQueryCount,
          duplicateTrainCount,
          spatialStatsBeforeDeduplication,
          spatialStatsAfterDeduplication
        }
      };
    } catch (error) {
      console.warn('Feature matching failed:', error);
      if (error?.code === 'INSUFFICIENT_SPATIAL_MATCHES') {
        throw error;
      }
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

  _deduplicateMatches(matches) {
    const sortedMatches = [...matches].sort((left, right) => (
      left.distance - right.distance
      || left.queryIdx - right.queryIdx
      || left.trainIdx - right.trainIdx
    ));
    const queryIndexes = new Set();
    const trainIndexes = new Set();

    return sortedMatches.filter((match) => {
      if (queryIndexes.has(match.queryIdx) || trainIndexes.has(match.trainIdx)) {
        return false;
      }

      queryIndexes.add(match.queryIdx);
      trainIndexes.add(match.trainIdx);
      return true;
    });
  }

  _spatialStats(matches, sourceFeatures, targetFeatures) {
    const sourcePoints = [];
    const targetPoints = [];

    for (const match of matches) {
      const sourcePoint = this._getKeypointCoordinates(sourceFeatures, match.queryIdx);
      const targetPoint = this._getKeypointCoordinates(targetFeatures, match.trainIdx);

      if (sourcePoint && targetPoint) {
        sourcePoints.push(sourcePoint);
        targetPoints.push(targetPoint);
      }
    }

    return {
      source: this._pointSpread(sourcePoints, sourceFeatures.width, sourceFeatures.height),
      target: this._pointSpread(targetPoints, targetFeatures.width, targetFeatures.height)
    };
  }

  _pointSpread(points, width, height) {
    if (points.length === 0) {
      return {
        minX: null,
        maxX: null,
        minY: null,
        maxY: null,
        spreadX: 0,
        spreadY: 0,
        spreadPercentX: 0,
        spreadPercentY: 0,
        coverage: 0
      };
    }

    const xValues = points.map((point) => point.x);
    const yValues = points.map((point) => point.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const spreadX = maxX - minX;
    const spreadY = maxY - minY;
    const imageWidth = Number(width) > 0 ? Number(width) : 0;
    const imageHeight = Number(height) > 0 ? Number(height) : 0;
    const imageArea = imageWidth * imageHeight;

    return {
      minX,
      maxX,
      minY,
      maxY,
      spreadX,
      spreadY,
      spreadPercentX: imageWidth > 0 ? spreadX / imageWidth : 0,
      spreadPercentY: imageHeight > 0 ? spreadY / imageHeight : 0,
      coverage: imageArea > 0 ? (spreadX * spreadY) / imageArea : 0
    };
  }

  _validateMatchGeometry(matches, spatialStats) {
    if (matches.length < 4) {
      throw this._createDegeneracyError('At least four unique feature correspondences are required.');
    }

    const isConcentrated = [spatialStats.source, spatialStats.target].some((spread) => (
      spread.spreadPercentX < 0.05
      || spread.spreadPercentY < 0.05
      || spread.coverage < 0.01
    ));

    if (isConcentrated) {
      throw this._createDegeneracyError('Insufficient spatially distributed feature matches.');
    }
  }

  _createDegeneracyError(message) {
    const error = new Error(message);
    error.code = 'INSUFFICIENT_SPATIAL_MATCHES';
    return error;
  }

  _getKeypointCoordinates(features, index) {
    if (!features?.keypoints || !Number.isInteger(index) || index < 0) {
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