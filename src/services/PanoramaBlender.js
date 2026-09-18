const DEFAULT_FEATHER_RADIUS = 50;
const DEFAULT_MAX_CANVAS_PIXELS = 100_000_000;

export class PanoramaBlender {
  constructor(cv, options = {}) {
    this.cv = cv;
    this.featherRadius = options.featherRadius ?? DEFAULT_FEATHER_RADIUS;
    this.maxCanvasPixels = options.maxCanvasPixels ?? DEFAULT_MAX_CANVAS_PIXELS;
  }

  async blend(images, composition, diagnostic = null) {
    let accumulation;
    let totalWeight;
    let normalized;
    let output;

    try {
      this._logStage('PanoramaBlender START', { imageCount: images?.length ?? null });
      this._logStage('input validation START');
      this._validateRuntime();
      this._validateComposition(images, composition);
      this._logStage('input validation SUCCESS', {
        images: images.length,
        canvas: { width: composition.width, height: composition.height }
      });
      const { width, height } = composition;
      accumulation = this.cv.Mat.zeros(height, width, this.cv.CV_32FC4);
      totalWeight = this.cv.Mat.zeros(height, width, this.cv.CV_32FC1);
      const maskCoverage = new Uint8Array(width * height);
      this._logStage('accumulator initialization SUCCESS', {
        accumulation: this._matDetails(accumulation),
        totalWeight: this._matDetails(totalWeight)
      });

      for (let index = 0; index < images.length; index += 1) {
        await this._accumulateImage(images[index], composition.placements[index], accumulation, totalWeight, diagnostic, maskCoverage);
      }

      const expandedWeight = new this.cv.Mat();
      try {
        this._mergeMats('merge total weight', [totalWeight, totalWeight, totalWeight, totalWeight], expandedWeight, diagnostic);
        normalized = new this.cv.Mat();
        this._operation('divide', () => this.cv.divide(accumulation, expandedWeight, normalized), diagnostic, [accumulation, expandedWeight]);
      } finally {
        expandedWeight.delete();
      }

      output = new this.cv.Mat();
      this._operation('normalized.convertTo', () => normalized.convertTo(output, this.cv.CV_8U), diagnostic, [normalized]);
      diagnostic?.log('BLEND OUTPUT', {
        normalized: this._matDetails(normalized),
        output: this._matDetails(output),
        totalWeight: this._matDetails(totalWeight),
        finalCanvas: { width, height },
        ...this._matCoverageSummary(totalWeight, 'final valid weight'),
        overlap: this._overlapSummary(maskCoverage, width, height)
      });
      if (output.empty?.()) {
        return { success: false, reason: 'EMPTY_OUTPUT' };
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      this.cv.imshow(canvas, output);
      this._logStage('final Mat SUCCESS', { output: this._matDetails(output) });
      this._logStage('PanoramaBlender SUCCESS');

      return {
        success: true,
        width,
        height,
        imageCount: images.length,
        featherRadius: this.featherRadius,
        blendedImage: canvas.toDataURL('image/png')
      };
    } catch (error) {
      console.error('[PanoramaBlender] operation FAILED:', error?.operation || 'pipeline');
      console.error('[PanoramaBlender] error:', error);
      console.error('[PanoramaBlender] stack:', error?.stack);
      diagnostic?.error('BLENDING FAILED', error);
      console.warn('Panorama blending failed:', error);
      return { success: false, reason: this._reasonFor(error) };
    } finally {
      accumulation?.delete?.();
      totalWeight?.delete?.();
      normalized?.delete?.();
      output?.delete?.();
    }
  }

  async _accumulateImage(image, placement, accumulation, totalWeight, diagnostic = null, maskCoverage = null) {
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
      this._operation('warpPerspective image', () => this.cv.warpPerspective(sourceMat, warpedMat, transformMat, new this.cv.Size(accumulation.cols, accumulation.rows), this.cv.INTER_LINEAR, this.cv.BORDER_CONSTANT, this._transparentBorder()), diagnostic, [sourceMat, transformMat]);
      this._operation('warpPerspective mask', () => this.cv.warpPerspective(sourceMask, warpedMask, transformMat, new this.cv.Size(accumulation.cols, accumulation.rows), this.cv.INTER_NEAREST, this.cv.BORDER_CONSTANT, this._scalar(0)), diagnostic, [sourceMask, transformMat]);
      diagnostic?.log('BLEND INPUT', {
        image: image.name,
        inputDimensions: { width: sourceMat.cols, height: sourceMat.rows },
        mask: { dimensions: { width: sourceMask.cols, height: sourceMask.rows }, type: sourceMask.type(), channels: sourceMask.channels(), validPixels: this._countNonZero(sourceMask) },
        warpedMask: { dimensions: { width: warpedMask.cols, height: warpedMask.rows }, type: warpedMask.type(), channels: warpedMask.channels(), ...this._matCoverageSummary(warpedMask, 'valid warped mask') },
        accumulator: { dimensions: { width: accumulation.cols, height: accumulation.rows }, type: accumulation.type() }
      });
      this._accumulateMaskCoverage(warpedMask, maskCoverage);

      distance = new this.cv.Mat();
      this._operation('distanceTransform', () => this.cv.distanceTransform(warpedMask, distance, this.cv.DIST_L2, 3), diagnostic, [warpedMask]);
      weight = new this.cv.Mat();
      this._operation('threshold', () => this.cv.threshold(distance, weight, this.featherRadius, this.featherRadius, this.cv.THRESH_TRUNC), diagnostic, [distance]);
      this._operation('weight.convertTo', () => weight.convertTo(weight, this.cv.CV_32F, 1 / this.featherRadius), diagnostic, [weight]);
      diagnostic?.log('FEATHER WEIGHTS', {
        image: image.name,
        featherRadius: this.featherRadius,
        ...this._matValueRange(weight, (value) => value > 0)
      });

      floatImage = new this.cv.Mat();
      this._operation('warpedMat.convertTo', () => warpedMat.convertTo(floatImage, this.cv.CV_32F), diagnostic, [warpedMat]);
      expandedWeight = new this.cv.Mat();
      this._mergeMats('merge weight', [weight, weight, weight, weight], expandedWeight, diagnostic);
      weightedImage = new this.cv.Mat();
      this._operation('multiply', () => this.cv.multiply(floatImage, expandedWeight, weightedImage), diagnostic, [floatImage, expandedWeight]);
      this._operation('add accumulation', () => this.cv.add(accumulation, weightedImage, accumulation), diagnostic, [accumulation, weightedImage]);
      this._operation('add totalWeight', () => this.cv.add(totalWeight, weight, totalWeight), diagnostic, [totalWeight, weight]);
      diagnostic?.log('BLEND ACCUMULATION', {
        image: image.name,
        weight: this._matDetails(weight),
        accumulation: this._matDetails(accumulation),
        totalWeight: this._matDetails(totalWeight)
      });
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

  _operation(name, operation, diagnostic, inputs = []) {
    this._logStage(`${name} START`, { inputs: inputs.map((mat) => this._matDetails(mat)) });
    try {
      const result = operation();
      this._logStage(`${name} SUCCESS`);
      return result;
    } catch (error) {
      error.operation = name;
      console.error('[PanoramaBlender] operation FAILED:', name);
      console.error('[PanoramaBlender] error:', error);
      console.error('[PanoramaBlender] stack:', error?.stack);
      diagnostic?.error('BLENDER OPERATION FAILED', error, { operation: name });
      throw error;
    }
  }

  _mergeMats(operationName, mats, destination, diagnostic) {
    let matVector;
    try {
      console.log('[PanoramaBlender] merge arguments', {
        operation: operationName,
        typeofMats: typeof mats,
        arrayIsMats: Array.isArray(mats),
        matsIsMatVector: mats instanceof this.cv.MatVector,
        matTypes: mats.map((mat) => this._matDetails(mat))
      });
      matVector = new this.cv.MatVector();
      console.log('[PanoramaBlender] MatVector constructor succeeded:', operationName);
      console.log('[PanoramaBlender] MatVector runtime', {
        operation: operationName,
        typeofMatVector: typeof matVector,
        hasPushBack: typeof matVector.push_back,
        initialSize: typeof matVector.size === 'function' ? matVector.size() : null
      });
      if (typeof matVector.push_back !== 'function') {
        throw new Error('OpenCV MatVector.push_back is unavailable.');
      }
      mats.forEach((mat) => matVector.push_back(mat));
      console.log('[PanoramaBlender] MatVector size:', typeof matVector.size === 'function' ? matVector.size() : null);
      mats.forEach((mat, index) => console.log(`[PanoramaBlender] input[${index}]:`, this._matDetails(mat)));
      diagnostic?.log('MERGE INPUT', {
        operation: operationName,
        previousArgumentType: 'Array',
        expectedArgumentType: 'cv.MatVector',
        matVectorSize: typeof matVector.size === 'function' ? matVector.size() : null,
        mats: mats.map((mat) => this._matDetails(mat)),
        destination: this._matDetails(destination)
      });
      this._operation(operationName, () => this.cv.merge(matVector, destination), diagnostic, mats);
      console.log('[PanoramaBlender] merge output:', this._matDetails(destination));
    } finally {
      matVector?.delete?.();
    }
  }

  _matDetails(mat) {
    const data = mat?.data32F || mat?.data64F || mat?.data8U || mat?.data;
    const values = data ? Array.from(data) : [];
    const finiteValues = values.filter((value) => Number.isFinite(value));
    const min = finiteValues.length > 0 ? finiteValues.reduce((result, value) => Math.min(result, value), Infinity) : null;
    const max = finiteValues.length > 0 ? finiteValues.reduce((result, value) => Math.max(result, value), -Infinity) : null;
    return {
      dimensions: { width: mat?.cols ?? null, height: mat?.rows ?? null },
      type: typeof mat?.type === 'function' ? mat.type() : null,
      channels: typeof mat?.channels === 'function' ? mat.channels() : null,
      min,
      max,
      zeroCount: values.length > 0 ? values.filter((value) => value === 0).length : null
    };
  }

  _countNonZero(mat) {
    const data = mat?.data || mat?.data8U;
    if (!data) return null;
    return Array.from(data).filter((value) => value !== 0).length;
  }

  _matCoverageSummary(mat, label) {
    const data = mat?.data || mat?.data8U || mat?.data32F;
    const channels = typeof mat?.channels === 'function' ? mat.channels() : 0;
    const width = mat?.cols ?? 0;
    const height = mat?.rows ?? 0;
    if (!data || channels !== 1 || width <= 0 || height <= 0) {
      return { label, validPixels: null, invalidPixels: null, invalidPercentage: null, validBoundingBox: null };
    }
    let validPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[y * width + x] !== 0) {
          validPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const pixelCount = width * height;
    return {
      label,
      validPixels,
      invalidPixels: pixelCount - validPixels,
      invalidPercentage: ((pixelCount - validPixels) / pixelCount) * 100,
      validBoundingBox: validPixels > 0 ? { minX, maxX, minY, maxY } : null
    };
  }

  _matValueRange(mat, predicate) {
    const data = mat?.data32F || mat?.data || mat?.data8U;
    if (!data) return { positivePixels: null, min: null, max: null };
    const values = Array.from(data).filter((value) => predicate(value));
    return {
      positivePixels: values.length,
      min: values.length > 0 ? Math.min(...values) : null,
      max: values.length > 0 ? Math.max(...values) : null
    };
  }

  _accumulateMaskCoverage(mask, coverage) {
    const data = mask?.data || mask?.data8U;
    if (!data || !coverage) return;
    for (let index = 0; index < coverage.length; index += 1) {
      if (data[index] !== 0 && coverage[index] < 255) coverage[index] += 1;
    }
  }

  _overlapSummary(coverage, width, height) {
    if (!coverage) return { overlapPixels: null, overlapPercentageOfUnion: null, unionPixels: null, unionBoundingBox: null };
    let overlapPixels = 0;
    let unionPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < coverage.length; index += 1) {
      if (coverage[index] > 0) {
        unionPixels += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (coverage[index] > 1) overlapPixels += 1;
    }
    return {
      overlapPixels,
      overlapPercentageOfUnion: unionPixels > 0 ? (overlapPixels / unionPixels) * 100 : null,
      unionPixels,
      unionBoundingBox: unionPixels > 0 ? { minX, maxX, minY, maxY } : null
    };
  }

  _logStage(operation, details = {}) {
    console.log(`[PanoramaBlender] ${operation}`, details);
  }

  _validateRuntime() {
    const required = ['Mat', 'MatVector', 'warpPerspective', 'distanceTransform', 'threshold', 'merge', 'multiply', 'add', 'divide', 'imshow'];
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