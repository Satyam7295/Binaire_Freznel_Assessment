const DEFAULT_ORB_CONFIG = Object.freeze({
  nFeatures: 500,
  scaleFactor: 1.2,
  nLevels: 8,
  edgeThreshold: 31,
  firstLevel: 0,
  WTA_K: 2,
  patchSize: 31,
  fastThreshold: 20
});

export class FeatureDetector {
  constructor(cv) {
    this.cv = cv;
    this.config = DEFAULT_ORB_CONFIG;
  }

  getConfig() {
    return { ...this.config };
  }

  async detect(imageModel) {
    if (!this.cv) {
      throw new Error('OpenCV is not initialized.');
    }

    if (!imageModel) {
      throw new Error('No image was provided for feature detection.');
    }

    const imageMat = await this._imageModelToMat(imageModel);
    const grayscaleMat = new this.cv.Mat();
    const maskMat = new this.cv.Mat();
    const keypoints = new this.cv.KeyPointVector();
    const descriptors = new this.cv.Mat();

    try {
      if (imageMat.channels() > 1) {
        this.cv.cvtColor(imageMat, grayscaleMat, this.cv.COLOR_RGBA2GRAY);
      } else {
        imageMat.copyTo(grayscaleMat);
      }

      const orb = this._createOrbInstance();

      try {
        orb.detectAndCompute(grayscaleMat, maskMat, keypoints, descriptors);
      } finally {
        orb.delete();
      }

      const keypointCount = typeof keypoints.size === 'function' ? keypoints.size() : 0;

      return {
        keypoints,
        descriptors,
        keypointCount,
        width: imageMat.cols,
        height: imageMat.rows,
        descriptorRows: descriptors.rows,
        descriptorCols: descriptors.cols
      };
    } catch (error) {
      if (keypoints && typeof keypoints.delete === 'function') {
        keypoints.delete();
      }

      if (descriptors && typeof descriptors.delete === 'function') {
        descriptors.delete();
      }

      throw error;
    } finally {
      imageMat.delete();
      grayscaleMat.delete();
      maskMat.delete();
    }
  }

  _createOrbInstance() {
    if (!this.cv || typeof this.cv.ORB !== 'function') {
      throw new Error('ORB is unavailable in the installed OpenCV.js runtime.');
    }

    const scoreType = this.cv.ORB_HARRIS_SCORE ?? 0;

    return new this.cv.ORB(
      this.config.nFeatures,
      this.config.scaleFactor,
      this.config.nLevels,
      this.config.edgeThreshold,
      this.config.firstLevel,
      this.config.WTA_K,
      scoreType,
      this.config.patchSize,
      this.config.fastThreshold
    );
  }

  async _imageModelToMat(imageModel) {
    const imageUrl = imageModel.previewUrl;

    if (!imageUrl) {
      throw new Error('The selected image does not have a usable preview source.');
    }

    const image = await this._loadImageElement(imageUrl, imageModel.name);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      throw new Error('The browser canvas API is unavailable.');
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

    return this.cv.matFromImageData(imageData);
  }

  _loadImageElement(source, name) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => {
        reject(new Error(`Unable to decode ${name || 'the selected image'}.`));
      };

      image.src = source;
    });
  }
}

export default FeatureDetector;
