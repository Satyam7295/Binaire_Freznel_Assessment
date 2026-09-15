import { useEffect, useRef, useState } from 'react';
import { Button, Heading, Text, View, Well } from '@adobe/react-spectrum';
import { createImageModels } from '../services/imageInputService.js';
import ImageCard from './ImageCard.jsx';

function ImageInputPanel() {
  const [images, setImages] = useState([]);
  const [rejectedFiles, setRejectedFiles] = useState([]);
  const fileInputRef = useRef(null);
  const imagesRef = useRef(images);

  imagesRef.current = images;

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => image.releasePreviewUrl());
    };
  }, []);

  function handleAddImages() {
    fileInputRef.current?.click();
  }

  async function handleFileSelection(event) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (files.length === 0) {
      return;
    }

    const result = await createImageModels(files, imagesRef.current);
    setImages((currentImages) => [...currentImages, ...result.images]);
    setRejectedFiles(result.rejectedFiles);
  }

  function handleRemoveImage(imageId) {
    const imageToRemove = images.find((image) => image.id === imageId);
    imageToRemove?.releasePreviewUrl();
    setImages((currentImages) => currentImages.filter((image) => image.id !== imageId));
  }

  return (
    <section className="image-input-panel" aria-labelledby="selected-images-heading">
      <View backgroundColor="gray-100" borderRadius="medium" padding="size-400" width="100%" maxWidth="size-6000">
        <Heading level={2}>Image Input</Heading>
        <Text>Select one or more JPEG, PNG, or AVIF images to begin.</Text>
        <div className="image-input-actions">
          <Button variant="accent" onPress={handleAddImages}>
            Add Images
          </Button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".jpg,.jpeg,.png,.avif,image/jpeg,image/png,image/avif"
            multiple
            onChange={handleFileSelection}
          />
        </div>

        {rejectedFiles.length > 0 && (
          <View backgroundColor="negative" borderRadius="regular" padding="size-200" marginTop="size-200">
            <Text>
              {rejectedFiles.map(({ name, reason }) => `${name}: ${reason}`).join(' ')}
            </Text>
          </View>
        )}

        <Heading level={2} id="selected-images-heading">Selected Images</Heading>
        {images.length === 0 ? (
          <Well>
            <Text>No images selected yet.</Text>
          </Well>
        ) : (
          <div className="image-grid">
            {images.map((image) => (
              <ImageCard key={image.id} image={image} onRemove={handleRemoveImage} />
            ))}
          </div>
        )}
      </View>
    </section>
  );
}

export default ImageInputPanel;