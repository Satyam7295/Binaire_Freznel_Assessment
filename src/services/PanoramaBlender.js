const DEFAULT_FEATHER_RADIUS = 50;
const DEFAULT_MAX_CANVAS_PIXELS = 100_000_000;

export class PanoramaBlender {
  constructor(cv, options = {}) {
    this.cv = cv;
    this.featherRadius = options.featherRadius ?? DEFAULT_FEATHER_RADIUS;
    this.maxCanvasPixels = options.maxCanvasPixels ?? DEFAULT_MAX_CANVAS_PIXELS;
  }

  async blend(images, composition) {
    let accumulation;
    let totalWeight;
    let normalized;
    let output;

    try {
      this._validateRuntime();
      this._validateComposition(images, composition);
      const { width, height } = composition;
      accumulation = this.cv.Mat.zeros(height, width, this.cv.CV_32FC4);
      totalWeight = this.cv.Mat.zeros(height, width, this.cv.CV_32FC1);

      for (let index = 0; index < images.length; index += 1) {
        await this._accumulateImage(images[index], composition.placements[index], accumulation, totalWeight);
      }

      const expandedWeight = new this.cv.Mat();
      try {
        this.cv.merge([totalWeight, totalWeight, totalWeight, totalWeight], expandedWeight);
        normalized = new this.cv.Mat();
        this.cv.divide(accumulation, expandedWeight, normalized);
      } finally {
        expandedWeight.delete();
      }

      output = new this.cv.Mat();
      normalized.convertTo(output, this.cv.CV_8U);
      if (output.empty?.()) {
        return { success: false, reason: 'EMPTY_OUTPUT' };
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      this.cv.imshow(canvas, output);

      return {
        success: true,
        width,
        height,
        imageCount: images.length,
        featherRadius: this.featherRadius,
        blendedImage: canvas.toDataURL('image/png')
      };
    } catch (error) {
      console.warn('Panorama blending failed:', error);
      return { success: false, reason: this._reasonFor(error) };
    } finally {
      accumulation?.delete?.();
      totalWeight?.delete?.();
      normalized?.delete?.();
      output?.delete?.();
    }
  }

  async _accumulateImage(image, placement, accumulation, totalWeight) {
    const sourceMat = await this._imageModelToMat(image);
    let transformMat;
    let warpedMat;
    let sourceMask;
    let warpedMask;
    let distance;
    let weight;
    let floatImage;
    let expandedWeight;
    let weightedImage;

    try {
      transformMat = this._createMatrixMat(placement.transform);
      warpedMat = new this.cv.Mat();
      sourceMask = new this.cv.Mat(sourceMat.rows, sourceMat.cols, this.cv.CV_8UC1);
      sourceMask.setTo(this._scalar(255));
      warpedMask = new this.cv.Mat();
      this.cv.warpPerspective(sourceMat, warpedMat, transformMat, new this.cv.Size(accumulation.cols, accumulation.rows), this.cv.INTER_LINEAR, this.cv.BORDER_CONSTANT, this._transparentBorder());
      this.cv.warpPerspective(sourceMask, warpedMask, transformMat, new this.cv.Size(accumulation.cols, accumulation.rows), this.cv.INTER_NEAREST, this.cv.BORDER_CONSTANT, this._scalar(0));

      distance = new this.cv.Mat();
      this.cv.distanceTransform(warpedMask, distance, this.cv.DIST_L2, 3);
      weight = new this.cv.Mat();
      this.cv.threshold(distance, weight, this.featherRadius, this.featherRadius, this.cv.THRESH_TRUNC);
      weight.convertTo(weight, this.cv.CV_32F, 1 / this.featherRadius);

      floatImage = new this.cv.Mat();
      warpedMat.convertTo(floatImage, this.cv.CV_32F);
      expandedWeight = new this.cv.Mat();
      this.cv.merge([weight, weight, weight, weight], expandedWeight);
      weightedImage = new this.cv.Mat();
      this.cv.multiply(floatImage, expandedWeight, weightedImage);
      this.cv.add(accumulation, weightedImage, accumulation);
      this.cv.add(totalWeight, weight, totalWeight);
    } finally {
      sourceMat.delete();
      transformMat?.delete?.();
      warpedMat?.delete?.();
      sourceMask?.delete?.();
      warpedMask?.delete?.();
      distance?.delete?.();
      weight?.delete?.();
      floatImage?.delete?.();
      expandedWeight?.delete?.();
      weightedImage?.delete?.();
    }
  }

  _validateRuntime() {
    const required = ['Mat', 'warpPerspective', 'distanceTransform', 'threshold', 'merge', 'multiply', 'add', 'divide', 'imshow'];
    if (!this.cv || required.some((name) => typeof this.cv[name] !== 'function')) {
      throw new Error('OPENCV_UNAVAILABLE');
    }
  }

  _validateComposition(images, composition) {
    if (!Array.isArray(images) || images.length === 0) throw new Error('NO_IMAGES');
    if (!composition?.success || !Array.isArray(composition.placements)) throw new Error('INVALID_COMPOSITION');
    if (composition.placements.length !== images.length) throw new Error('INVALID_COMPOSITION');
    if (!Number.isInteger(composition.width) || !Number.isInteger(composition.height) || composition.width <= 0 || composition.height <= 0) throw new Error('INVALID_DIMENSIONS');
    if (composition.width * composition.height > this.maxCanvasPixels) throw new Error('PANORAMA_TOO_LARGE');
    if (!Number.isFinite(this.featherRadius) || this.featherRadius <= 0) throw new Error('INVALID_FEATHER_RADIUS');
  }

  _createMatrixMat(matrix) {
    const values = Array.isArray(matrix) ? matrix.flat() : [];
    if (values.length !== 9 || values.some((value) => !Number.isFinite(value)) || this.cv.CV_64F === undefined) throw new Error('INVALID_PLACEMENT');
    const result = new this.cv.Mat(3, 3, this.cv.CV_64F);
    result.data64F.set(values);
    return result;
  }

  _scalar(value) {
    return typeof this.cv.Scalar === 'function' ? new this.cv.Scalar(value, value, value, value) : [value, value, value, value];
  }

  _transparentBorder() {
    return this._scalar(0);
  }

  _reasonFor(error) {
    const knownReasons = ['NO_IMAGES', 'INVALID_COMPOSITION', 'INVALID_DIMENSIONS', 'PANORAMA_TOO_LARGE', 'INVALID_FEATHER_RADIUS', 'INVALID_PLACEMENT', 'EMPTY_OUTPUT', 'OPENCV_UNAVAILABLE'];
    return knownReasons.includes(error.message) ? error.message : 'BLENDING_FAILED';
  }

  async _imageModelToMat(imageModel) {
    if (!imageModel?.previewUrl) throw new Error('The source image does not have a usable preview source.');
    const image = await this._loadImageElement(imageModel.previewUrl, imageModel.name);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || canvas.width <= 0 || canvas.height <= 0) throw new Error('INVALID_DIMENSIONS');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return this.cv.matFromImageData(context.getImageData(0, 0, canvas.width, canvas.height));
  }

  _loadImageElement(source, name) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to decode ${name || 'the source image'}.`));
      image.src = source;
    });
  }
}

export default PanoramaBlender;