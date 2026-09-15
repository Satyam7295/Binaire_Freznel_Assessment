export class ImageModel {
  constructor(file) {
    this.id = `${file.name}-${file.size}-${file.lastModified}`;
    this.name = file.name;
    this.type = file.type;
    this.size = file.size;
    this.file = file;
    this.previewUrl = URL.createObjectURL(file);
    this.width = null;
    this.height = null;
  }

  loadMetadata() {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        this.width = image.naturalWidth;
        this.height = image.naturalHeight;
        resolve(this);
      };

      image.onerror = () => {
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