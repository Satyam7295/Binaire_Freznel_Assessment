import { Button, Content, Flex, Heading, Image, Text, View } from '@adobe/react-spectrum';

function formatFileSize(size) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageCard({ image, onRemove }) {
  return (
    <View borderColor="gray-300" borderWidth="thin" borderRadius="regular" padding="size-150">
      <Flex direction="column" gap="size-150">
        <Image
          src={image.previewUrl}
          alt={`Preview of ${image.name}`}
          width="100%"
          height="size-2400"
          objectFit="cover"
        />
        <Content>
          <Heading level={3}>{image.name}</Heading>
          <Text>
            {image.width} x {image.height} · {formatFileSize(image.size)}
          </Text>
        </Content>
        <Button variant="secondary" onPress={() => onRemove(image.id)}>
          Remove
        </Button>
      </Flex>
    </View>
  );
}

export default ImageCard;