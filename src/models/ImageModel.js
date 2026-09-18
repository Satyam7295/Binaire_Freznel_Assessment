export class ImageModel {
  constructor(file) {
    this.id = `${file.name}-${file.size}-${file.lastModified}`;
    this.name = file.name;
    this.type = file.type;
    this.size = file.size;
    this.file = file;
    this.previewUrl = URL.createObjectURL(file);
    console.log('[ImageLoading] model created:', {
      name: this.name,
      type: this.type,
      size: this.size,
      previewUrl: this.previewUrl
    });
    this.width = null;
    this.height = null;
  }

  loadMetadata() {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        this.width = image.naturalWidth;
        this.height = image.naturalHeight;
        console.log('[ImageLoading] metadata loaded:', {
          name: this.name,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          complete: image.complete,
          previewUrl: this.previewUrl
        });
        resolve(this);
      };

      image.onerror = () => {
        console.error('[ImageLoading] metadata load failed:', { name: this.name, previewUrl: this.previewUrl });
        reject(new Error(`Unable to decode ${this.name}`));
      };

      image.src = this.previewUrl;
    });
  }

  releasePreviewUrl() {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
  }
}