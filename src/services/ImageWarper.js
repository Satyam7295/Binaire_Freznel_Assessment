export class ImageWarper {
  constructor(cv) {
    this.cv = cv;
  }

  async warp(imageModel, homographyResult) {
    this._validateRuntime();
    this._validateHomographyResult(homographyResult);

    if (!imageModel) {
      throw new Error('No source image was provided for warping.');
    }

    const sourceMat = await this._imageModelToMat(imageModel);
    let homographyMat;
    let warpedMat;

    try {
      homographyMat = this._createHomographyMat(homographyResult.homography);
      warpedMat = new this.cv.Mat();
      const targetWidth = homographyResult.targetWidth;
      const targetHeight = homographyResult.targetHeight;
      console.log('[GEOMETRY] Image warp bounds', {
        pair: imageModel.name,
        sourceDimensions: { width: homographyResult.sourceWidth, height: homographyResult.sourceHeight },
        targetDimensions: { width: targetWidth, height: targetHeight },
        transformedSourceCorners: this._transformCorners(homographyResult.homography, homographyResult.sourceWidth, homographyResult.sourceHeight)
      });
      const borderValue = typeof this.cv.Scalar === 'function'
        ? new this.cv.Scalar(0, 0, 0, 0)
        : [0, 0, 0, 0];

      this.cv.warpPerspective(
        sourceMat,
        warpedMat,
        homographyMat,
        new this.cv.Size(targetWidth, targetHeight),
        this.cv.INTER_LINEAR,
        this.cv.BORDER_CONSTANT,
        borderValue
      );

      if (warpedMat.empty?.() || warpedMat.cols !== targetWidth || warpedMat.rows !== targetHeight) {
        throw new Error('OpenCV returned an empty warped image.');
      }

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = targetWidth;
      previewCanvas.height = targetHeight;
      this.cv.imshow(previewCanvas, warpedMat);

      return {
        success: true,
        width: targetWidth,
        height: targetHeight,
        warpedImage: previewCanvas.toDataURL('image/png')
      };
    } catch (error) {
      console.warn('Image warping failed:', error);
      throw new Error('Image warping failed.');
    } finally {
      sourceMat.delete();
      homographyMat?.delete?.();
      warpedMat?.delete?.();
    }
  }

  _validateRuntime() {
    if (!this.cv) {
      throw new Error('OpenCV is not initialized.');
    }

    if (typeof this.cv.Mat !== 'function' || typeof this.cv.warpPerspective !== 'function') {
      throw new Error('OpenCV image warping is unavailable.');
    }

    if (typeof this.cv.imshow !== 'function' || typeof this.cv.Size !== 'function') {
      throw new Error('OpenCV image output is unavailable.');
    }
  }

  _validateHomographyResult(result) {
    if (!result?.success) {
      throw new Error('Homography estimation was not successful.');
    }

    const values = this._flattenHomography(result.homography);
    if (values.length !== 9 || values.some((value) => !Number.isFinite(value))) {
      throw new Error('The homography is invalid.');
    }

    if (!this._isValidDimension(result.sourceWidth) || !this._isValidDimension(result.sourceHeight)
      || !this._isValidDimension(result.targetWidth) || !this._isValidDimension(result.targetHeight)) {
      throw new Error('The homography image dimensions are invalid.');
    }
  }

  _flattenHomography(homography) {
    if (!Array.isArray(homography)) {
      return [];
    }

    if (homography.length === 9 && homography.every((value) => typeof value === 'number')) {
      return homography;
    }

    if (homography.length !== 3 || homography.some((row) => !Array.isArray(row) || row.length !== 3)) {
      return [];
    }

    return homography.flat();
  }

  _createHomographyMat(homography) {
    if (this.cv.CV_64F === undefined) {
      throw new Error('OpenCV homography matrices are unavailable.');
    }

    const homographyMat = new this.cv.Mat(3, 3, this.cv.CV_64F);
    homographyMat.data64F.set(this._flattenHomography(homography));
    return homographyMat;
  }

  _isValidDimension(value) {
    return Number.isInteger(value) && value > 0;
  }

  _transformCorners(matrix, width, height) {
    const values = this._flattenHomography(matrix);
    const corners = [[0, 0], [width, 0], [width, height], [0, height]];
    return corners.map(([x, y]) => {
      const denominator = values[6] * x + values[7] * y + values[8];
      return {
        input: [x, y],
        output: [
          (values[0] * x + values[1] * y + values[2]) / denominator,
          (values[3] * x + values[4] * y + values[5]) / denominator
        ]
      };
    });
  }

  async _imageModelToMat(imageModel) {
    const imageUrl = imageModel.previewUrl;

    if (!imageUrl) {
      throw new Error('The source image does not have a usable preview source.');
    }

    const image = await this._loadImageElement(imageUrl, imageModel.name);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    if (!this._isValidDimension(canvas.width) || !this._isValidDimension(canvas.height)) {
      throw new Error('The source image dimensions are invalid.');
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('The browser canvas API is unavailable.');
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

export default ImageWarper;