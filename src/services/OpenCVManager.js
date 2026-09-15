import cv from '@techstark/opencv-js';

export const OPEN_CV_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  FAILED: 'failed'
});

class OpenCVManager {
  constructor() {
    this.state = OPEN_CV_STATES.IDLE;
    this.cv = null;
    this.initializationPromise = null;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  getCV() {
    return this.cv;
  }

  _notify() {
    this.listeners.forEach((listener) => listener(this.state));
  }

  async initialize() {
    if (this.state === OPEN_CV_STATES.READY && this.cv) {
      return this.cv;
    }

    if (this.state === OPEN_CV_STATES.LOADING && this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.state === OPEN_CV_STATES.FAILED && this.initializationPromise) {
      return this.initializationPromise;
    }

    this.state = OPEN_CV_STATES.LOADING;
    this._notify();

    this.initializationPromise = (async () => {
      try {
        const runtimeSource = typeof window !== 'undefined' ? (window.cv ?? cv) : cv;

        if (runtimeSource && typeof runtimeSource.then === 'function') {
          await runtimeSource;
        }

        const runtime = typeof window !== 'undefined' ? (window.cv ?? runtimeSource) : runtimeSource;

        if (!runtime || typeof runtime.Mat !== 'function') {
          throw new Error('OpenCV.js loaded without a usable runtime.');
        }

        this.cv = runtime;
        this.state = OPEN_CV_STATES.READY;
        this._notify();
        return this.cv;
      } catch (error) {
        console.error('OpenCV initialization failed.', error);
        this.cv = null;
        this.state = OPEN_CV_STATES.FAILED;
        this._notify();
        throw new Error('OpenCV is unavailable.');
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }
}

export const openCVManager = new OpenCVManager();
export default openCVManager;
