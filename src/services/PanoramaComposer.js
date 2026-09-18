const DEFAULT_MAX_CANVAS_PIXELS = 100_000_000;

export class PanoramaComposer {
  constructor(cv, options = {}) {
    this.cv = cv;
    this.maxCanvasPixels = options.maxCanvasPixels ?? DEFAULT_MAX_CANVAS_PIXELS;
  }

  async compose(images, pairwiseHomographies, diagnostic = null) {
    try {
      this._validateRuntime();

      if (!Array.isArray(images) || images.length < 2) {
        return { success: false, reason: 'AT_LEAST_TWO_IMAGES_REQUIRED', imageCount: 0 };
      }

      if (!Array.isArray(pairwiseHomographies) || pairwiseHomographies.length < images.length - 1) {
        return { success: false, reason: 'MISSING_PAIRWISE_HOMOGRAPHY', imageCount: 0 };
      }

      const globalTransforms = [this._identityMatrix()];
      const failedPairs = [];

      for (let index = 0; index < images.length - 1; index += 1) {
        const homographyResult = pairwiseHomographies[index];

        try {
          const pairHomography = this._readHomography(homographyResult);
          const inversePairHomography = this._invertMatrix(pairHomography);
          globalTransforms.push(this._multiplyMatrices(globalTransforms[index], inversePairHomography));
          console.log('[GEOMETRY] Transform accumulation', {
            pair: homographyResult?.label ?? `${images[index]?.name} to ${images[index + 1]?.name}`,
            order: `G${index + 1} = G${index} * inverse(H${index}->${index + 1})`,
            imageTransform: globalTransforms[index + 1]
          });
          diagnostic?.log('GLOBAL TRANSFORM', {
            image: `G${index + 1}`,
            formula: `G${index + 1} = G${index} * inverse(H${index}->${index + 1})`,
            matrix: globalTransforms[index + 1]
          });
        } catch (error) {
          failedPairs.push({
            index,
            label: homographyResult?.label ?? `${images[index]?.name ?? 'Image'} to ${images[index + 1]?.name ?? 'Image'}`,
            reason: error.message
          });
          break;
        }
      }

      if (failedPairs.length > 0 || globalTransforms.length !== images.length) {
        return {
          success: false,
          reason: 'INVALID_PAIRWISE_HOMOGRAPHY',
          failedPairs,
          imageCount: 0
        };
      }

      const dimensions = images.map((image) => this._getImageDimensions(image));
      const bounds = this._calculateBounds(dimensions, globalTransforms);
      const canvas = this._getCanvasSize(bounds);
      const offsetX = -bounds.minX;
      const offsetY = -bounds.minY;
      const translation = [
        [1, 0, offsetX],
        [0, 1, offsetY],
        [0, 0, 1]
      ];
      console.log('[GEOMETRY] Panorama bounds and translation', {
        globalTransforms,
        bounds,
        offsetX,
        offsetY,
        canvas: { width: canvas.width, height: canvas.height }
      });
      diagnostic?.log('COMPOSER BOUNDS', {
        globalTransforms,
        globalTransformedCorners: this._calculateDiagnosticCorners(dimensions, globalTransforms),
        bounds,
        canvas: { width: canvas.width, height: canvas.height },
        offsetX,
        offsetY
      });
      const canvasTransforms = globalTransforms.map((transform) => (
        this._multiplyMatrices(translation, transform)
      ));

      const compositionCanvas = document.createElement('canvas');
      compositionCanvas.width = canvas.width;
      compositionCanvas.height = canvas.height;
      const compositionContext = compositionCanvas.getContext('2d');

      if (!compositionContext) {
        throw new Error('The browser canvas API is unavailable.');
      }

      let imageCount = 0;
      for (let index = 0; index < images.length; index += 1) {
        const sourceMat = await this._imageModelToMat(images[index]);
        let transformMat;
        let transformedMat;
        let warpedCanvas;

        try {
          transformMat = this._createMatrixMat(canvasTransforms[index]);
          transformedMat = new this.cv.Mat();
          this.cv.warpPerspective(
            sourceMat,
            transformedMat,
            transformMat,
            new this.cv.Size(canvas.width, canvas.height),
            this.cv.INTER_LINEAR,
            this.cv.BORDER_CONSTANT,
            this._transparentBorder()
          );

          if (transformedMat.empty?.()) {
            throw new Error('OpenCV returned an empty transformed image.');
          }

          warpedCanvas = document.createElement('canvas');
          warpedCanvas.width = canvas.width;
          warpedCanvas.height = canvas.height;
          this.cv.imshow(warpedCanvas, transformedMat);
          compositionContext.drawImage(warpedCanvas, 0, 0);
          diagnostic?.log('COMPOSITION WARP', {
            image: images[index].name,
            sourceDimensions: { width: sourceMat.cols, height: sourceMat.rows },
            destinationDimensions: { width: canvas.width, height: canvas.height },
            warpMatrix: canvasTransforms[index],
            outputDimensions: { width: transformedMat.cols, height: transformedMat.rows },
            borderMode: 'BORDER_CONSTANT',
            geometricBounds: this._boundsFromPoints(this._calculateDiagnosticCorners([{
              width: dimensions[index].width,
              height: dimensions[index].height
            }], [canvasTransforms[index]])[0].corners),
            ...this._matCoverageSummary(transformedMat, 'warped image')
          });
          imageCount += 1;
        } finally {
          sourceMat.delete();
          transformMat?.delete?.();
          transformedMat?.delete?.();
        }
      }

      const compositionData = compositionContext.getImageData(0, 0, canvas.width, canvas.height);
      const compositionPixels = this._pixelSummary(compositionData);
      diagnostic?.log('COMPOSITION BEFORE BLENDING', {
        canvas: { width: canvas.width, height: canvas.height },
        ...compositionPixels,
        debugImage: compositionCanvas.toDataURL('image/png')
      });

      return {
        success: true,
        width: canvas.width,
        height: canvas.height,
        offsetX,
        offsetY,
        imageCount,
        placements: canvasTransforms.map((transform, index) => ({
          transform,
          width: dimensions[index].width,
          height: dimensions[index].height
        })),
        composedImage: compositionCanvas.toDataURL('image/png')
      };
    } catch (error) {
      console.warn('Panorama composition failed:', error);
      return { success: false, reason: error.message || 'COMPOSITION_FAILED', imageCount: 0 };
    }
  }

  _validateRuntime() {
    if (!this.cv || typeof this.cv.Mat !== 'function' || typeof this.cv.warpPerspective !== 'function') {
      throw new Error('OpenCV panorama composition is unavailable.');
    }

    if (typeof this.cv.imshow !== 'function' || typeof this.cv.Size !== 'function') {
      throw new Error('OpenCV image output is unavailable.');
    }
  }

  _readHomography(result) {
    if (!result?.success) {
      throw new Error(result?.reason || 'Homography estimation was not successful.');
    }

    const values = Array.isArray(result.homography) && result.homography.length === 3
      ? result.homography.flat()
      : [];

    if (values.length !== 9 || values.some((value) => !Number.isFinite(value))) {
      throw new Error('The homography is invalid.');
    }

    return [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)];
  }

  _identityMatrix() {
    return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  }

  _multiplyMatrices(left, right) {
    const result = Array.from({ length: 3 }, () => [0, 0, 0]);

    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        for (let index = 0; index < 3; index += 1) {
          result[row][column] += left[row][index] * right[index][column];
        }
      }
    }

    return result;
  }

  _invertMatrix(matrix) {
    const [a, b, c] = matrix[0];
    const [d, e, f] = matrix[1];
    const [g, h, i] = matrix[2];
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);

    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      throw new Error('The homography cannot be inverted.');
    }

    const inverse = [
      [e * i - f * h, c * h - b * i, b * f - c * e],
      [f * g - d * i, a * i - c * g, c * d - a * f],
      [d * h - e * g, b * g - a * h, a * e - b * d]
    ];

    return inverse.map((row) => row.map((value) => value / determinant));
  }

  _calculateBounds(dimensions, transforms) {
    const cornersByImage = dimensions.map(({ width, height }, index) => (
      [[0, 0], [width, 0], [width, height], [0, height]]
        .map(([x, y]) => this._transformPoint(transforms[index], x, y))
    ));
    console.log('[GEOMETRY] Global transformed corners', JSON.stringify(cornersByImage));
    const corners = cornersByImage.flat();

    if (corners.some((point) => !point)) {
      throw new Error('The transformed image bounds are invalid.');
    }

    return corners.reduce((bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      minY: Math.min(bounds.minY, y),
      maxX: Math.max(bounds.maxX, x),
      maxY: Math.max(bounds.maxY, y)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  }

  _transformPoint(matrix, x, y) {
    const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
    const transformedX = (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator;
    const transformedY = (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator;

    return Number.isFinite(denominator) && Math.abs(denominator) > 1e-12
      && Number.isFinite(transformedX) && Number.isFinite(transformedY)
      ? [transformedX, transformedY]
      : null;
  }

  _calculateDiagnosticCorners(dimensions, transforms) {
    return dimensions.map(({ width, height }, index) => ({
      image: index,
      corners: [[0, 0], [width, 0], [width, height], [0, height]]
        .map(([x, y]) => ({ input: [x, y], output: this._transformPoint(transforms[index], x, y) }))
    }));
  }

  _boundsFromPoints(points) {
    const coordinates = points
      .map((point) => point.output)
      .filter((point) => Array.isArray(point) && point.every((value) => Number.isFinite(value)));
    if (coordinates.length === 0) return null;
    return coordinates.reduce((bounds, [x, y]) => ({
      minX: Math.min(bounds.minX, x),
      minY: Math.min(bounds.minY, y),
      maxX: Math.max(bounds.maxX, x),
      maxY: Math.max(bounds.maxY, y)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  }

  _countValidPixels(mat) {
    const data = mat?.data || mat?.data8U;
    const channels = typeof mat?.channels === 'function' ? mat.channels() : 0;
    if (!data || !channels) return null;
    let validPixels = 0;
    for (let index = 0; index < mat.rows * mat.cols; index += 1) {
      const offset = index * channels;
      const valid = channels === 4
        ? data[offset + 3] !== 0
        : Array.from({ length: channels }, (_, channel) => data[offset + channel]).some((value) => value !== 0);
      if (valid) validPixels += 1;
    }
    return validPixels;
  }

  _pixelSummary(imageData) {
    const { data, width, height } = imageData;
    let validPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] !== 0 && (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0)) {
          validPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return {
      validPixels,
      emptyPixels: width * height - validPixels,
      invalidPercentage: ((width * height - validPixels) / (width * height)) * 100,
      validBoundingBox: validPixels > 0 ? { minX, maxX, minY, maxY } : null
    };
  }

  _matCoverageSummary(mat, label) {
    const data = mat?.data || mat?.data8U;
    const channels = typeof mat?.channels === 'function' ? mat.channels() : 0;
    const width = mat?.cols ?? 0;
    const height = mat?.rows ?? 0;
    if (!data || !channels || width <= 0 || height <= 0) {
      return { label, validPixels: null, invalidPixels: null, invalidPercentage: null, validBoundingBox: null };
    }

    let validPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * channels;
        const valid = channels === 4
          ? data[offset + 3] !== 0
          : Array.from({ length: channels }, (_, channel) => data[offset + channel]).some((value) => value !== 0);
        if (valid) {
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

  _getCanvasSize(bounds) {
    const width = Math.ceil(bounds.maxX - bounds.minX);
    const height = Math.ceil(bounds.maxY - bounds.minY);

    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new Error('The calculated panorama dimensions are invalid.');
    }

    if (width * height > this.maxCanvasPixels) {
      throw new Error('The calculated panorama is too large to render safely.');
    }

    return { width, height };
  }

  _createMatrixMat(matrix) {
    if (this.cv.CV_64F === undefined) {
      throw new Error('OpenCV homography matrices are unavailable.');
    }

    const matrixMat = new this.cv.Mat(3, 3, this.cv.CV_64F);
    matrixMat.data64F.set(matrix.flat());
    return matrixMat;
  }

  _transparentBorder() {
    return typeof this.cv.Scalar === 'function'
      ? new this.cv.Scalar(0, 0, 0, 0)
      : [0, 0, 0, 0];
  }

  _getImageDimensions(image) {
    const width = image?.width;
    const height = image?.height;

    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error(`Image dimensions are invalid for ${image?.name || 'the selected image'}.`);
    }

    return { width, height };
  }

  async _imageModelToMat(imageModel) {
    if (!imageModel?.previewUrl) {
      throw new Error('The source image does not have a usable preview source.');
    }

    const image = await this._loadImageElement(imageModel.previewUrl, imageModel.name);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context || !canvas.width || !canvas.height) {
      throw new Error('The source image dimensions or browser canvas API are invalid.');
    }

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

export default PanoramaComposer;