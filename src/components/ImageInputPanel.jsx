import { useEffect, useRef, useState } from 'react';
import { Button, Heading, Text, View, Well } from '@adobe/react-spectrum';
import { createImageModels } from '../services/imageInputService.js';
import FeatureDetector from '../services/FeatureDetector.js';
import FeatureMatcher from '../services/FeatureMatcher.js';
import HomographyEstimator from '../services/HomographyEstimator.js';
import ImageWarper from '../services/ImageWarper.js';
import PanoramaComposer from '../services/PanoramaComposer.js';
import openCVManager, { OPEN_CV_STATES } from '../services/OpenCVManager.js';
import ImageCard from './ImageCard.jsx';

function ImageInputPanel() {
  const [images, setImages] = useState([]);
  const [rejectedFiles, setRejectedFiles] = useState([]);
  const [opencvState, setOpenCVState] = useState(openCVManager.getState());
  const [featureStatus, setFeatureStatus] = useState('');
  const [featureCount, setFeatureCount] = useState(null);
  const [isDetectingFeatures, setIsDetectingFeatures] = useState(false);
  const [matchingStatus, setMatchingStatus] = useState('');
  const [matchingResults, setMatchingResults] = useState([]);
  const [isMatchingFeatures, setIsMatchingFeatures] = useState(false);
  const [homographyStatus, setHomographyStatus] = useState('');
  const [homographyResults, setHomographyResults] = useState([]);
  const [isEstimatingHomography, setIsEstimatingHomography] = useState(false);
  const [warpStatus, setWarpStatus] = useState('');
  const [warpResults, setWarpResults] = useState([]);
  const [isWarpingImages, setIsWarpingImages] = useState(false);
  const [compositionStatus, setCompositionStatus] = useState('');
  const [compositionResult, setCompositionResult] = useState(null);
  const [isComposingPanorama, setIsComposingPanorama] = useState(false);
  const fileInputRef = useRef(null);
  const imagesRef = useRef(images);
  const featureResultsRef = useRef(new Map());

  imagesRef.current = images;

  useEffect(() => {
    const unsubscribe = openCVManager.subscribe(setOpenCVState);

    return () => {
      unsubscribe();
      imagesRef.current.forEach((image) => image.releasePreviewUrl());
      featureResultsRef.current.forEach((result) => releaseFeatureResult(result));
      featureResultsRef.current.clear();
    };
  }, []);

  function releaseFeatureResult(result) {
    result?.keypoints?.delete?.();
    result?.descriptors?.delete?.();
  }

  function handleAddImages() {
    fileInputRef.current?.click();
  }

  async function handleDetectFeatures() {
    if (images.length === 0) {
      setFeatureStatus('Select an image before running feature detection.');
      setFeatureCount(null);
      return;
    }

    if (opencvState !== OPEN_CV_STATES.READY || !openCVManager.getCV()) {
      setFeatureStatus('OpenCV is not ready yet.');
      setFeatureCount(null);
      return;
    }

    const image = images[0];

    try {
      setIsDetectingFeatures(true);
      setFeatureStatus('Detecting features...');
      setFeatureCount(null);

      const detector = new FeatureDetector(openCVManager.getCV());
      const result = await detector.detect(image);
      const previousResult = featureResultsRef.current.get(image.id);
      releaseFeatureResult(previousResult);
      featureResultsRef.current.set(image.id, result);

      if (result.keypointCount > 0) {
        setFeatureStatus('Feature detection successful.');
        setFeatureCount(result.keypointCount);
      } else {
        setFeatureStatus('No keypoints were detected in this image.');
        setFeatureCount(0);
      }
    } catch (error) {
      console.warn('Feature detection failed:', error);
      setFeatureStatus('Feature detection failed for this image.');
      setFeatureCount(null);
    } finally {
      setIsDetectingFeatures(false);
    }
  }

  async function getFeatureResult(image, detector) {
    const cachedResult = featureResultsRef.current.get(image.id);

    if (cachedResult) {
      return cachedResult;
    }

    const result = await detector.detect(image);
    featureResultsRef.current.set(image.id, result);
    return result;
  }

  async function handleMatchFeatures() {
    if (images.length < 2) {
      setMatchingStatus('Select at least two images before matching features.');
      setMatchingResults([]);
      return;
    }

    if (opencvState !== OPEN_CV_STATES.READY || !openCVManager.getCV()) {
      setMatchingStatus('OpenCV is not ready yet.');
      setMatchingResults([]);
      return;
    }

    const detector = new FeatureDetector(openCVManager.getCV());
    const matcher = new FeatureMatcher(openCVManager.getCV());
    const results = [];

    try {
      setIsMatchingFeatures(true);
      setMatchingStatus('Matching adjacent image pairs...');
      setMatchingResults([]);

      for (let index = 0; index < images.length - 1; index += 1) {
        const sourceImage = images[index];
        const targetImage = images[index + 1];
        const sourceFeatures = await getFeatureResult(sourceImage, detector);
        const targetFeatures = await getFeatureResult(targetImage, detector);
        const matchResult = matcher.match(sourceFeatures, targetFeatures);

        results.push({
          label: `${sourceImage.name} to ${targetImage.name}`,
          matchCount: matchResult.matchCount
        });
      }

      setMatchingResults(results);
      setMatchingStatus('Feature matching completed.');
    } catch (error) {
      console.warn('Feature matching failed:', error);
      setMatchingResults([]);
      setMatchingStatus('Feature matching failed for the selected images.');
    } finally {
      setIsMatchingFeatures(false);
    }
  }

  async function handleEstimateHomography() {
    if (images.length < 2) {
      setHomographyStatus('Select at least two images before estimating a homography.');
      setHomographyResults([]);
      return;
    }

    if (opencvState !== OPEN_CV_STATES.READY || !openCVManager.getCV()) {
      setHomographyStatus('OpenCV is not ready yet.');
      setHomographyResults([]);
      return;
    }

    const detector = new FeatureDetector(openCVManager.getCV());
    const matcher = new FeatureMatcher(openCVManager.getCV());
    const estimator = new HomographyEstimator(openCVManager.getCV());
    const results = [];

    try {
      setIsEstimatingHomography(true);
      setHomographyStatus('Estimating adjacent image homographies...');
      setHomographyResults([]);

      for (let index = 0; index < images.length - 1; index += 1) {
        const sourceImage = images[index];
        const targetImage = images[index + 1];
        const sourceFeatures = await getFeatureResult(sourceImage, detector);
        const targetFeatures = await getFeatureResult(targetImage, detector);
        const matchResult = matcher.match(sourceFeatures, targetFeatures);
        const homographyResult = estimator.estimate(sourceFeatures, targetFeatures, matchResult);

        results.push({
          label: `${sourceImage.name} to ${targetImage.name}`,
          ...homographyResult
        });
      }

      setHomographyResults(results);
      setHomographyStatus('Homography estimation completed.');
    } catch (error) {
      console.warn('Homography estimation failed:', error);
      setHomographyResults([]);
      setHomographyStatus('Homography estimation failed for the selected images.');
    } finally {
      setIsEstimatingHomography(false);
    }
  }

  async function handleWarpImages() {
    if (images.length < 2) {
      setWarpStatus('Select at least two images before warping.');
      setWarpResults([]);
      return;
    }

    if (opencvState !== OPEN_CV_STATES.READY || !openCVManager.getCV()) {
      setWarpStatus('OpenCV is not ready yet.');
      setWarpResults([]);
      return;
    }

    const cv = openCVManager.getCV();
    const detector = new FeatureDetector(cv);
    const matcher = new FeatureMatcher(cv);
    const estimator = new HomographyEstimator(cv);
    const warper = new ImageWarper(cv);
    const results = [];

    try {
      setIsWarpingImages(true);
      setWarpStatus('Warping adjacent image pairs...');
      setWarpResults([]);

      for (let index = 0; index < images.length - 1; index += 1) {
        const sourceImage = images[index];
        const targetImage = images[index + 1];
        const sourceFeatures = await getFeatureResult(sourceImage, detector);
        const targetFeatures = await getFeatureResult(targetImage, detector);
        const matchResult = matcher.match(sourceFeatures, targetFeatures);
        const homographyResult = estimator.estimate(sourceFeatures, targetFeatures, matchResult);
        const warpResult = homographyResult.success
          ? await warper.warp(sourceImage, homographyResult)
          : { success: false };

        results.push({
          label: `${sourceImage.name} to ${targetImage.name}`,
          homographyResult,
          warpResult
        });
      }

      setWarpResults(results);
      setWarpStatus('Image warping completed.');
    } catch (error) {
      console.warn('Image warping validation failed:', error);
      setWarpResults([]);
      setWarpStatus('Image warping failed for the selected images.');
    } finally {
      setIsWarpingImages(false);
    }
  }

  async function handleComposePanorama() {
    if (images.length < 2) {
      setCompositionStatus('Select at least two images before composing a panorama.');
      setCompositionResult(null);
      return;
    }

    if (opencvState !== OPEN_CV_STATES.READY || !openCVManager.getCV()) {
      setCompositionStatus('OpenCV is not ready yet.');
      setCompositionResult(null);
      return;
    }

    const cv = openCVManager.getCV();
    const detector = new FeatureDetector(cv);
    const matcher = new FeatureMatcher(cv);
    const estimator = new HomographyEstimator(cv);
    const composer = new PanoramaComposer(cv);

    try {
      setIsComposingPanorama(true);
      setCompositionStatus('Calculating global transforms and composing panorama...');
      setCompositionResult(null);
      const homographies = [];

      for (let index = 0; index < images.length - 1; index += 1) {
        const sourceImage = images[index];
        const targetImage = images[index + 1];
        const sourceFeatures = await getFeatureResult(sourceImage, detector);
        const targetFeatures = await getFeatureResult(targetImage, detector);
        const matchResult = matcher.match(sourceFeatures, targetFeatures);
        const homographyResult = estimator.estimate(sourceFeatures, targetFeatures, matchResult);

        homographies.push({
          label: `${sourceImage.name} to ${targetImage.name}`,
          ...homographyResult
        });
      }

      const result = await composer.compose(images, homographies);
      setCompositionResult(result);
      const failedPairLabel = result.failedPairs?.map((pair) => pair.label).join(', ');
      setCompositionStatus(result.success
        ? 'Panorama composition successful.'
        : `Panorama composition failed (${result.reason})${failedPairLabel ? ` for ${failedPairLabel}.` : '.'}`);
    } catch (error) {
      console.warn('Panorama composition validation failed:', error);
      setCompositionResult(null);
      setCompositionStatus('Panorama composition failed for the selected images.');
    } finally {
      setIsComposingPanorama(false);
    }
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
    const featureResult = featureResultsRef.current.get(imageId);
    releaseFeatureResult(featureResult);
    featureResultsRef.current.delete(imageId);
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

        {images.length > 0 && (
          <View backgroundColor="gray-100" borderRadius="regular" padding="size-250" marginTop="size-250">
            <Heading level={3}>Feature Detection</Heading>
            <div className="image-input-actions">
              <Button
                variant="secondary"
                onPress={handleDetectFeatures}
                isDisabled={isDetectingFeatures || isMatchingFeatures || isEstimatingHomography || isWarpingImages || isComposingPanorama || opencvState !== OPEN_CV_STATES.READY}
              >
                {isDetectingFeatures ? 'Detecting...' : 'Detect Features'}
              </Button>
              <Button
                variant="secondary"
                onPress={handleMatchFeatures}
                isDisabled={isDetectingFeatures || isMatchingFeatures || isEstimatingHomography || isWarpingImages || isComposingPanorama || opencvState !== OPEN_CV_STATES.READY}
              >
                {isMatchingFeatures ? 'Matching...' : 'Match Features'}
              </Button>
              <Button
                variant="secondary"
                onPress={handleEstimateHomography}
                isDisabled={isDetectingFeatures || isMatchingFeatures || isEstimatingHomography || isWarpingImages || isComposingPanorama || opencvState !== OPEN_CV_STATES.READY}
              >
                {isEstimatingHomography ? 'Estimating...' : 'Estimate Homography'}
              </Button>
              <Button
                variant="secondary"
                onPress={handleWarpImages}
                isDisabled={isDetectingFeatures || isMatchingFeatures || isEstimatingHomography || isWarpingImages || isComposingPanorama || opencvState !== OPEN_CV_STATES.READY}
              >
                {isWarpingImages ? 'Warping...' : 'Warp Image'}
              </Button>
              <Button
                variant="accent"
                onPress={handleComposePanorama}
                isDisabled={isDetectingFeatures || isMatchingFeatures || isEstimatingHomography || isWarpingImages || isComposingPanorama || opencvState !== OPEN_CV_STATES.READY}
              >
                {isComposingPanorama ? 'Composing...' : 'Compose Panorama'}
              </Button>
            </div>
            {featureStatus && (
              <Text>
                {featureCount !== null ? `${featureCount} keypoints detected.` : featureStatus}
              </Text>
            )}
            {matchingStatus && <Text>{matchingStatus}</Text>}
            {matchingResults.map(({ label, matchCount }) => (
              <Text key={label}>
                {matchCount > 0
                  ? `${label}: Feature matching successful - ${matchCount} good matches.`
                  : `${label}: Not enough reliable matches.`}
              </Text>
            ))}
            {homographyStatus && <Text>{homographyStatus}</Text>}
            {homographyResults.map(({ label, success, matchCount, inlierCount, inlierRatio, reason }) => (
              <Text key={`homography-${label}`}>
                {success
                  ? `${label}: ${matchCount} matches, ${inlierCount} RANSAC inliers (inlier ratio: ${(inlierRatio * 100).toFixed(1)}%). Homography estimation successful.`
                  : `${label}: Homography estimation failed (${reason}).`}
              </Text>
            ))}
            {warpStatus && <Text>{warpStatus}</Text>}
            {warpResults.map(({ label, homographyResult, warpResult }) => (
              <View key={`warp-${label}`} marginTop="size-150">
                <Text>
                  {homographyResult.success
                    ? `${label}: Homography successful, ${homographyResult.inlierCount} / ${homographyResult.matchCount} inliers. ${warpResult.success ? `Warp successful - output ${warpResult.width} x ${warpResult.height}.` : 'Warp failed.'}`
                    : `${label}: Homography estimation failed; image was not warped.`}
                </Text>
                {warpResult.success && (
                  <img className="warp-preview" src={warpResult.warpedImage} alt={`Warped preview of ${label}`} />
                )}
              </View>
            ))}
            {compositionStatus && <Text>{compositionStatus}</Text>}
            {compositionResult?.success && (
              <View marginTop="size-200">
                <Text>
                  Images: {compositionResult.imageCount} | Canvas: {compositionResult.width} x {compositionResult.height} | Offset: ({compositionResult.offsetX.toFixed(1)}, {compositionResult.offsetY.toFixed(1)})
                </Text>
                <img className="panorama-preview" src={compositionResult.composedImage} alt="Composed panorama preview" />
              </View>
            )}
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