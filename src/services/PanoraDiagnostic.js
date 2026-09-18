let nextRunNumber = 1;

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function matrixSummary(matrix) {
  return Array.isArray(matrix) ? matrix.map((row) => [...row]) : matrix;
}

export function transformPoint(matrix, x, y) {
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  return {
    input: [x, y],
    output: [
      finiteOrNull((matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator),
      finiteOrNull((matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator)
    ]
  };
}

export function transformedCorners(matrix, width, height) {
  return [[0, 0], [width, 0], [width, height], [0, height]]
    .map(([x, y]) => transformPoint(matrix, x, y));
}

export function boundsFromPoints(points) {
  const coordinates = points
    .map((point) => point.output ?? point)
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  if (coordinates.length === 0) {
    return { minX: null, maxX: null, minY: null, maxY: null };
  }

  return coordinates.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x),
    maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y),
    maxY: Math.max(bounds.maxY, y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

export function matSummary(mat, includePixels = false) {
  const summary = {
    rows: mat?.rows ?? null,
    cols: mat?.cols ?? null,
    channels: typeof mat?.channels === 'function' ? mat.channels() : null,
    type: typeof mat?.type === 'function' ? mat.type() : null,
    empty: typeof mat?.empty === 'function' ? mat.empty() : null
  };

  if (!includePixels || !mat || summary.rows === null || summary.cols === null) {
    return summary;
  }

  const pixelCount = summary.rows * summary.cols;
  const channels = summary.channels || 1;
  const data = mat.data || mat.data8U || mat.data32F || mat.data64F;
  let validPixels = null;

  if (data && data.length >= pixelCount * channels) {
    validPixels = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const offset = pixel * channels;
      const isValid = channels === 4
        ? data[offset + 3] !== 0
        : Array.from({ length: channels }, (_, index) => data[offset + index]).some((value) => value !== 0);
      if (isValid) validPixels += 1;
    }
  }

  return { ...summary, pixelCount, validPixels, emptyPixels: validPixels === null ? null : pixelCount - validPixels };
}

export class PanoraDiagnostic {
  constructor(images) {
    this.runId = `run-${Date.now()}-${nextRunNumber++}`;
    this.log('RUN START', {
      runId: this.runId,
      imageCount: images.length,
      images: images.map((image) => ({ name: image.name, width: image.width, height: image.height }))
    });
  }

  log(stage, details = {}) {
    console.log('[PanoraDiagnostic]', { runId: this.runId, stage, ...details });
  }

  error(stage, error, details = {}) {
    console.error('[PanoraDiagnostic]', {
      runId: this.runId,
      stage,
      ...details,
      error: error?.message,
      stack: error?.stack
    });
  }
}

export default PanoraDiagnostic;
