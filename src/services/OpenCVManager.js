import * as opencvModule from '@techstark/opencv-js';

export const OPEN_CV_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  FAILED: 'failed'
});

const OPEN_CV_TIMEOUT_MS = 15000;

class OpenCVManager {
  constructor() {
    this.state = OPEN_CV_STATES.IDLE;
    this.cv = null;
    this.initializationPromise = null;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  getCV() {
    return this.cv;
  }

  _notify() {
    console.log(`[DIAG] Manager notifying state: ${this.state}`);
    this.listeners.forEach((listener) => listener(this.state));
  }

  async initialize() {
    if (this.state === OPEN_CV_STATES.READY && this.cv) {
      return this.state;
    }

    if (this.state === OPEN_CV_STATES.LOADING && this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.state === OPEN_CV_STATES.FAILED && this.initializationPromise) {
      return this.initializationPromise;
    }

    this.state = OPEN_CV_STATES.LOADING;
    console.log('[OpenCV] import started');
    this._notify();

    this.initializationPromise = (async () => {
      try {
        console.log('[OpenCV] import completed');
        const runtimeSource = typeof window !== 'undefined'
          ? (window.cv ?? opencvModule.cv ?? opencvModule.default ?? opencvModule)
          : (opencvModule.cv ?? opencvModule.default ?? opencvModule);
        console.log('[OpenCV] module received:', runtimeSource);
        console.log(`[OpenCV] module shape Mat=${typeof runtimeSource?.Mat} then=${typeof runtimeSource?.then} calledRun=${runtimeSource?.calledRun}`);
        await this._waitForRuntime(runtimeSource);
        const runtime = runtimeSource;

        if (!runtime || typeof runtime.Mat !== 'function') {
          throw new Error('OpenCV.js loaded without a usable runtime.');
        }

        const verificationMat = new runtime.Mat();
        verificationMat.delete();
        console.log('[OpenCV] runtime ready');

        this.cv = runtime;
        this.state = OPEN_CV_STATES.READY;
        console.log('[OpenCV] cv available:', !!this.cv);
        console.log('[OpenCV] ORB available:', typeof this.cv?.ORB);
        this._notify();
        return this.state;
      } catch (error) {
        console.error('OpenCV initialization failed.', error);
        console.error('[DIAG] OpenCV initialization failed');
        this.cv = null;
        this.state = OPEN_CV_STATES.FAILED;
        this._notify();
        throw new Error(`OpenCV is unavailable: ${error.message}`, { cause: error });
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  _waitForRuntime(runtimeSource) {
    if (runtimeSource && typeof runtimeSource.Mat === 'function') {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`OpenCV runtime did not initialize within ${OPEN_CV_TIMEOUT_MS} ms.`));
        }, OPEN_CV_TIMEOUT_MS);

        const resolveRuntime = () => {
          clearTimeout(timeoutId);
          console.log('[DIAG] OpenCV runtime callback');
          resolve(runtimeSource);
        };

        runtimeSource.onRuntimeInitialized = resolveRuntime;

        if (runtimeSource.calledRun) {
          setTimeout(resolveRuntime, 0);
        }
      });
    }

    if (runtimeSource && typeof runtimeSource.then === 'function') {
      return Promise.race([
        new Promise((resolve) => runtimeSource.then(() => {
          console.log('[DIAG] OpenCV runtime callback');
          resolve();
        })),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`OpenCV runtime did not initialize within ${OPEN_CV_TIMEOUT_MS} ms.`)), OPEN_CV_TIMEOUT_MS);
        })
      ]);
    }

    return Promise.reject(new Error('OpenCV.js did not expose an initialized runtime.'));
  }
}

export const openCVManager = new OpenCVManager();
export default openCVManager;
