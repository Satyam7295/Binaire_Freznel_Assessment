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
    console.log('[FeatureDetection] stage started');
    console.log('[DIAG] Image input type:', imageModel?.constructor?.name ?? typeof imageModel);
    console.log('[FeatureDetection] Image dimensions:', `${imageModel?.width ?? 'unknown'}x${imageModel?.height ?? 'unknown'}`);
    console.log('[DIAG] Image data available:', Boolean(imageModel?.file));
    console.log('[FeatureDetection] ImageModel.previewUrl:', imageModel?.previewUrl ?? null);
    console.log('[FeatureDetection] cv ready:', !!this.cv);
    console.log('[FeatureDetection] cv state:', JSON.stringify({
      Mat: typeof this.cv?.Mat,
      imread: typeof this.cv?.imread,
      matFromImageData: typeof this.cv?.matFromImageData,
      cvtColor: typeof this.cv?.cvtColor,
      ORB: typeof this.cv?.ORB,
      ORB_create: typeof this.cv?.ORB_create,
      KeyPointVector: typeof this.cv?.KeyPointVector,
      runtimeInitialized: this.cv?.calledRun
    }));

    if (!this.cv) {
      throw new Error('OpenCV is not initialized.');
    }

    if (!imageModel) {
      throw new Error('No image was provided for feature detection.');
    }

    let imageMat;
    let grayscaleMat;
    let maskMat;
    let keypoints;
    let descriptors;

    try {
      imageMat = await this._imageModelToMat(imageModel);
      console.log('[FeatureDetection] input mat:', JSON.stringify({
        rows: imageMat.rows,
        cols: imageMat.cols,
        channels: imageMat.channels(),
        type: imageMat.type(),
        empty: typeof imageMat.empty === 'function' ? imageMat.empty() : 'unknown'
      }));
      grayscaleMat = new this.cv.Mat();
      maskMat = new this.cv.Mat();
      keypoints = new this.cv.KeyPointVector();
      descriptors = new this.cv.Mat();

      if (imageMat.channels() > 1) {
        try {
          console.log('[FeatureDetection] cvtColor operation started');
          this.cv.cvtColor(imageMat, grayscaleMat, this.cv.COLOR_RGBA2GRAY);
        } catch (error) {
          console.error('[FeatureDetection] cvtColor FAILED', error);
          throw error;
        }
      } else {
        imageMat.copyTo(grayscaleMat);
      }
      console.log('[FeatureDetection] grayscale mat:', JSON.stringify({
        rows: grayscaleMat.rows,
        cols: grayscaleMat.cols,
        channels: grayscaleMat.channels(),
        type: grayscaleMat.type()
      }));

      const orb = this._createOrbInstance();
      console.log('[FeatureDetection] ORB created:', orb);
      console.log('[FeatureDetection] detectAndCompute available:', typeof orb?.detectAndCompute);

      try {
        console.log('[FeatureDetection] ORB.detectAndCompute started');
        orb.detectAndCompute(grayscaleMat, maskMat, keypoints, descriptors);
        console.log('[FeatureDetection] ORB.detectAndCompute completed');
      } catch (error) {
        console.error('[FeatureDetection] ROOT EXCEPTION:', error);
        console.error('[FeatureDetection] stack:', error?.stack);
        console.error('[FeatureDetection] message:', error?.message);
        throw error;
      } finally {
        orb?.delete?.();
      }

      const keypointCount = typeof keypoints.size === 'function' ? keypoints.size() : 0;
      console.log('[FeatureDetection] keypoint count:', keypointCount);
      console.log('[FeatureDetection] descriptor dimensions/type:', JSON.stringify({
        rows: descriptors.rows,
        cols: descriptors.cols,
        channels: descriptors.channels(),
        type: descriptors.type()
      }));

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
      console.error('[ROOT FAILURE]', {
        stage: 'Feature Detection',
        operation: 'image conversion, grayscale conversion, ORB creation, or ORB.detectAndCompute',
        type: error?.constructor?.name,
        message: error?.message,
        stack: error?.stack,
        inputMat: imageMat ? `${imageMat.rows}x${imageMat.cols}, channels=${imageMat.channels()}, type=${imageMat.type()}` : 'unavailable'
      });

      if (keypoints && typeof keypoints.delete === 'function') {
        keypoints.delete();
      }

      if (descriptors && typeof descriptors.delete === 'function') {
        descriptors.delete();
      }

      throw error;
    } finally {
      imageMat?.delete?.();
      grayscaleMat?.delete?.();
      maskMat?.delete?.();
    }
  }

  _createOrbInstance() {
    console.log('[FeatureDetection] ORB API:', JSON.stringify({
      ORB: typeof this.cv?.ORB,
      ORB_create: typeof this.cv?.ORB_create,
      ORB_createMethod: typeof this.cv?.ORB?.create
    }));

    if (typeof this.cv?.ORB !== 'function') {
      throw new Error('The installed OpenCV.js runtime does not expose the cv.ORB constructor.');
    }

    console.log('[FeatureDetection] ORB creation method: new cv.ORB()');
    const orb = new this.cv.ORB();
    console.log('[FeatureDetection] ORB instance:', orb);
    console.log('[FeatureDetection] detectAndCompute:', typeof orb?.detectAndCompute);

    if (!orb || typeof orb.detectAndCompute !== 'function') {
      orb?.delete?.();
      throw new Error('The constructed cv.ORB instance does not expose detectAndCompute.');
    }

    return orb;
  }

  async _imageModelToMat(imageModel) {
    console.log('[FeatureDetection] image -> canvas -> ImageData -> mat started');
    console.log('[DIAG] cv.imread available:', typeof this.cv?.imread === 'function');
    const imageUrl = imageModel.previewUrl;

    if (!imageUrl) {
      throw new Error('The selected image does not have a usable preview source.');
    }

    const image = await this._loadImageElement(imageUrl, imageModel.name);
    console.log('[FeatureDetection] HTMLImageElement loaded:', JSON.stringify({
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      complete: image.complete
    }));
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    console.log('[FeatureDetection] canvas dimensions:', `${canvas.width}x${canvas.height}`);

    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      throw new Error('The browser canvas API is unavailable.');
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    console.log('[FeatureDetection] ImageData dimensions:', JSON.stringify({
      width: imageData.width,
      height: imageData.height,
      dataLength: imageData.data.length
    }));

    try {
      const mat = this.cv.matFromImageData(imageData);
      console.log('[FeatureDetection] cv.matFromImageData result:', JSON.stringify({
        rows: mat.rows,
        cols: mat.cols,
        channels: mat.channels(),
        type: mat.type()
      }));
      return mat;
    } catch (error) {
      console.error('[FeatureDetection] cv.matFromImageData FAILED:', error);
      throw error;
    }
  }

  _loadImageElement(source, name) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      console.log('[FeatureDetection] HTMLImageElement created:', { name, source });

      image.onload = () => {
        console.log('[FeatureDetection] HTMLImageElement onload:', JSON.stringify({
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          complete: image.complete
        }));
        resolve(image);
      };
      image.onerror = () => {
        reject(new Error(`Unable to decode ${name || 'the selected image'}.`));
      };

      image.src = source;
    });
  }
}

export default FeatureDetector;
