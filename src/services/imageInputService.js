import { ImageModel } from '../models/ImageModel.js';

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/avif']);
const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'avif']);

function getExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot === -1 ? '' : fileName.slice(lastDot + 1).toLowerCase();
}

function getFileKey(file) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function validateImageFile(file) {
  const extension = getExtension(file.name);
  const hasSupportedType = SUPPORTED_MIME_TYPES.has(file.type.toLowerCase());
  const hasSupportedExtension = SUPPORTED_EXTENSIONS.has(extension);

  if (!hasSupportedType && !hasSupportedExtension) {
    return {
      valid: false,
      reason: 'unsupported format. Use JPEG, PNG, or AVIF.'
    };
  }

  return { valid: true };
}

export async function createImageModels(files, existingImages) {
  const existingKeys = new Set(existingImages.map((image) => getFileKey(image.file)));
  const seenKeys = new Set(existingKeys);
  const images = [];
  const rejectedFiles = [];

  for (const file of files) {
    const validation = validateImageFile(file);
    const fileKey = getFileKey(file);

    if (!validation.valid) {
      rejectedFiles.push({ name: file.name, reason: validation.reason });
      continue;
    }

    if (seenKeys.has(fileKey)) {
      rejectedFiles.push({ name: file.name, reason: 'it is already selected.' });
      continue;
    }

    const image = new ImageModel(file);

    try {
      await image.loadMetadata();
      images.push(image);
      seenKeys.add(fileKey);
    } catch (error) {
      image.releasePreviewUrl();
      rejectedFiles.push({ name: file.name, reason: 'the image could not be read.' });
      console.warn('Image could not be loaded:', file.name, error);
    }
  }

  return { images, rejectedFiles };
}