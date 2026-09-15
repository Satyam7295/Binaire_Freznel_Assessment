# Panora - Developer Notes

## Project Goal

Build a desktop panoramic image stitching application that accepts JPEG, PNG, AVIF, and technically supported AVIF HDR images; creates cylindrical and spherical panoramas from multiple images; provides a pan, zoom, and rotation viewer; and exports JPEG, PNG, and AVIF results.

## Technology Stack

- **Electron.js:** Desktop shell and secure main-process lifecycle.
- **React.js:** Renderer UI composition.
- **Vite:** Renderer development server and production bundler.
- **Adobe React Spectrum:** Accessible UI components and application theming.
- **OpenCV.js 4.9.0 (via @techstark/opencv-js 4.9.0-release.3):** Local browser-side image-processing runtime and initialization boundary.
- **JavaScript:** Project language for both Electron and React code.

## Architecture

The application uses a one-way security boundary:

```text
Electron Main Process -> Preload Script -> contextBridge -> React Renderer
```

The main process owns the desktop window and privileged Electron responsibilities. The preload script exposes only explicitly selected, narrowly scoped capabilities through `contextBridge`. The React renderer owns the UI and cannot access Node.js or Electron modules directly.

## OOP Strategy

Imported files are represented by the `ImageModel` class. It owns the selected `File`, preview object URL, identifying metadata, and decoded width and height. It is responsible for loading image metadata and releasing its preview URL when the image is removed or the input panel is unmounted.

The application also includes `OpenCVManager`, a lifecycle boundary for loading and initializing the OpenCV.js runtime in the renderer. It is responsible for guarding duplicate initialization, exposing the instantiated OpenCV object, tracking readiness state, and surfacing a clean failure state without crashing the rest of the UI. Future image-processing classes should depend on the manager rather than directly importing or bootstrapping OpenCV themselves.

The renderer now includes a dedicated `FeatureDetector` class that converts an `ImageModel` into a browser-safe OpenCV `Mat`, converts the image to grayscale for ORB, detects keypoints, and computes descriptors. A separate `FeatureMatcher` class compares two detector results with an OpenCV Hamming `BFMatcher`, KNN matching, and Lowe's ratio test. `HomographyEstimator` consumes those detector and matcher results, estimates a robust source-to-target geometric transform, and returns only serializable homography data and RANSAC statistics. `ImageWarper` now consumes an `ImageModel` and a successful homography result, applies `cv.warpPerspective`, and returns a lossless browser preview in target coordinates. Panorama composition, blending, stitching, projection, and export remain future responsibilities and are intentionally not part of this implementation.

Future processing concepts include `ImageBlender`, `PanoramaStitcher`, projection strategies, and `PanoramaExporter`. `ImageWarper` is implemented as the current boundary; these remaining OpenCV-related concepts remain architectural intentions only.

## Security Decisions

- **contextIsolation:** Enabled so preload and renderer JavaScript execute in separate contexts.
- **nodeIntegration:** Disabled so the renderer cannot import Node.js APIs.
- **contextBridge:** Used by the preload script to expose a minimal `electronAPI` surface.
- **IPC boundary:** Future privileged operations will cross an explicit preload/main-process IPC boundary rather than exposing Electron or Node.js directly to React.
- **sandbox:** Enabled for the renderer window to add another layer of process isolation.

## Current Implementation

The project currently includes a Vite-powered React renderer inside an Electron window. Adobe React Spectrum is mounted at the application root with its `Provider`, and the UI displays the Panora name plus an OpenCV readiness indicator. Development mode loads the Vite server, while production mode loads the built `dist/index.html` file. The `start` script explicitly selects production mode for testing the built renderer before packaging is introduced.

The application can now select multiple images through the browser file input, validate JPEG, PNG, and AVIF files, display local previews and basic metadata, and remove individual selected images. Invalid, unreadable, and duplicate files are reported to the user while valid files from the same selection are retained.

OpenCV.js is now loaded locally as a static dependency through `@techstark/opencv-js` version `4.9.0-release.3`, which maps to the required OpenCV.js 4.9.x runtime. The library is bundled with the renderer by Vite, which avoids a remote CDN dependency and keeps the initialization path local and deterministic. The `OpenCVManager` class waits for the runtime to initialize before publishing the ready state, guards repeat `initialize()` calls with a single shared promise, and reports a user-visible `Unavailable` status if the runtime never becomes ready. Failure details are logged to the console without exposing traces to the renderer.

Selected images can now be converted into OpenCV `cv.Mat` objects, preprocessed for feature detection, and processed with ORB to detect keypoints and compute descriptors. This is implemented in a dedicated `FeatureDetector` service and is isolated from the UI components. The development validation surface can also match adjacent selected-image pairs and estimate homographies. `FeatureMatcher` accepts two `FeatureDetectionResult` objects, applies Hamming KNN matching with two candidates per query descriptor, rejects ambiguous candidates with a centralized `ratioThreshold` default of `0.75`, and returns plain JavaScript correspondence data. `HomographyEstimator` uses `queryIdx` and `trainIdx` to retrieve `x, y` keypoint coordinates, requires at least four valid correspondences, applies RANSAC, and reports the inlier count and ratio without calculating any warp.

The initial file-selection workflow uses browser `File` and `URL` APIs in the React renderer. It does not use Electron filesystem APIs or upload files to a server.

## Implementation Roadmap

1. Add the image-input workflow and supported file validation. (Implemented.)
2. Add OpenCV.js loading and image-processing service boundaries. (Implemented: `OpenCVManager` and local runtime initialization.)
3. Implement feature detection, matching, and homography estimation for panorama creation. (Implemented.)
4. Implement image warping, composition, and blending for panorama creation. (Image warping and global composition implemented; blending not done.)
5. Add cylindrical and spherical projection strategies. (Not done.)
6. Add the panorama viewer with pan, zoom, and rotation controls. (Not done.)
7. Add JPEG, PNG, and AVIF export. (Not done.)
8. Expand the preload IPC API only where desktop capabilities are required. (Not done.)
9. Add focused automated tests and production packaging configuration. (Not done.)

## Technical Decisions

### DEC-001: React + Vite renderer

**Decision:** Use React as the renderer UI framework and Vite as its development server and production bundler.

**Reason:** This meets the project requirements while keeping renderer feedback fast and the build configuration small.

**Trade-offs:** Electron development requires a separate Vite process and a small amount of startup coordination.

### DEC-002: Secure Electron preload bridge

**Decision:** Use a preload script with `contextIsolation: true`, `nodeIntegration: false`, and a narrow `contextBridge` API.

**Reason:** Renderer code should remain isolated from Node.js and privileged desktop APIs, limiting the impact of compromised or unsafe renderer content.

**Trade-offs:** Future desktop features require explicit preload APIs and IPC handlers instead of direct module access from React.

### DEC-003: ImageModel for imported images

**Decision:** Represent each accepted image with an `ImageModel` instance rather than passing raw `File` objects through the UI.

**Reason:** The model provides one responsibility boundary for preview URL ownership, image decoding, and dimensions while keeping React components focused on presentation and interaction.

**Trade-offs:** The model must be explicitly released when an image is removed or the input panel is unmounted, and metadata loading is asynchronous.

### DEC-004: Browser File APIs for initial image selection

**Decision:** Use a browser `<input type="file" multiple>` through the React renderer for initial image selection.

**Reason:** Local file selection does not require privileged filesystem access or an Electron IPC channel, which preserves the existing security boundary and keeps this feature local-only.

**Trade-offs:** File metadata and decoding behavior depend on browser support, and future privileged file operations will need a separate preload API.

### DEC-005: Centralized OpenCV.js lifecycle management

**Decision:** Keep OpenCV.js initialization in a dedicated `OpenCVManager` service rather than in React components or feature classes.

**Reason:** The OpenCV runtime is asynchronous, must be initialized only once, and should have a clear ready/failed state. Centralizing the lifecycle keeps the renderer UI simple and makes future processing classes depend on a single runtime boundary.

**Trade-offs:** There is a small amount of lifecycle state management to maintain, and the manager must remain intentionally narrow so it does not absorb unrelated image-processing logic.

### DEC-006: Dedicated FeatureDetector class

**Decision:** Create a dedicated `FeatureDetector` service whose sole responsibility is converting an `ImageModel` into an OpenCV `Mat`, preparing the image for detection, and running ORB to produce keypoints and descriptors.

**Reason:** Feature detection is a single, testable OpenCV task with its own lifecycle and output contract. Separating it from the future `FeatureMatcher` and `PanoramaStitcher` keeps the code small, prevents hidden coupling, and allows each later stage to consume a clear, stable intermediate representation without mixing responsibilities.

**Trade-offs:** The detector must own a narrow API contract and avoid absorbing future matching or stitching logic. This keeps the implementation simple but means additional orchestration will be added later in a dedicated stage.

**Memory management:** The detector creates a browser-side `Image` object, draws it to a canvas, converts the pixel buffer into an OpenCV `cv.Mat`, then performs grayscale conversion and ORB detection. Temporary mats created during preprocessing are deleted in a `finally` block after the detector finishes, while the returned `keypoints` and `descriptors` remain live because they are the actual output of the detection stage. This keeps object lifetimes explicit and avoids leaking intermediate OpenCV allocations.

### DEC-007: Dedicated FeatureMatcher class

**Decision:** Use a renderer-side `FeatureMatcher` service with OpenCV `BFMatcher`, Hamming distance, KNN matching with `k = 2`, and a centralized Lowe ratio threshold of `0.75` for ORB descriptors.

**Reason:** ORB produces binary descriptors, so Hamming distance is the appropriate comparison metric. Returning only ratio-test-approved descriptor correspondences provides a small, stable contract for a future geometric stage without coupling matching to homography estimation or stitching.

**Trade-offs:** The matcher handles exactly two feature results at a time. Multi-image orchestration currently belongs only to the development validation UI, which checks adjacent pairs and does not infer global image order.

**Memory management:** The matcher does not delete caller-owned keypoints or descriptor mats. It deletes its temporary `BFMatcher` and KNN match container in `finally` blocks and converts accepted matches into plain JavaScript objects. Matching produces correspondences, but it does not determine geometric transforms.

### DEC-008: Dedicated HomographyEstimator class

**Decision:** Use a renderer-side `HomographyEstimator` to estimate a `source -> target` 3x3 homography from matched keypoint coordinates with OpenCV `findHomography` and RANSAC.

**Reason:** Homography estimation is the geometric boundary between correspondences and the future image-warping stage. Keeping it isolated makes the input/output contract testable, prevents matching from absorbing transformation logic, and ensures that warping can later consume a stable serializable result without changing feature detection or matching.

**Contract:** The estimator accepts two `FeatureDetectionResult` objects and one `FeatureMatchResult`. It validates match indexes, constructs `CV_32FC2` source and target point matrices, requires at least four valid correspondences, and returns either a serializable 3x3 matrix with dimensions and RANSAC statistics or a structured failure reason. `inlierRatio` is calculated as `inlierCount / matchCount` from the RANSAC mask.

**Configuration:** RANSAC uses `ransacReprojThreshold: 3.0`, `maxIters: 2000`, and `confidence: 0.995` with the OpenCV `RANSAC` method.

**Memory management:** Point matrices, the returned homography matrix, and the RANSAC mask are temporary estimator-owned OpenCV objects and are deleted in `finally`. Keypoint and descriptor objects remain owned by the detector/UI lifecycle and are never deleted by the estimator. The homography matrix is converted to nested JavaScript arrays before deletion.

### DEC-009: Dedicated ImageWarper class

**Decision:** Use a renderer-side `ImageWarper` to convert the source `ImageModel` through the established browser canvas path, create a temporary OpenCV homography matrix, and apply `cv.warpPerspective` from source coordinates into target coordinates.

**Reason:** Warping produces one geometrically transformed image, while composition must later decide how multiple transformed images share a global canvas. Keeping these stages separate prevents panorama bounds, placement, blending, and seam decisions from leaking into the current transformation boundary.

**Output:** The initial output size is exactly `targetWidth` by `targetHeight` from the successful homography result. The result contract is `{ success, width, height, warpedImage }`, where `warpedImage` is a PNG data URL produced from the warped Mat. PNG preserves the current pixel data without introducing a lossy JPEG intermediate and is directly usable by the renderer validation preview.

**Border handling:** `cv.BORDER_CONSTANT` with a transparent `(0, 0, 0, 0)` border value is used so pixels outside the transformed source do not become meaningful content during future composition.

**Memory ownership:** The source Mat, homography Mat, and warped Mat are temporary and owned by `ImageWarper`; all are deleted in `finally`. The returned data URL does not retain an OpenCV Mat, so callers do not need to release an OpenCV object. The original feature and homography result objects are never modified or invalidated.

### DEC-010: Dedicated PanoramaComposer with a global reference coordinate system

**Decision:** Use image 0 as the global reference and make `PanoramaComposer` responsible for cumulative placement, canvas bounds, translation, and draw-order composition. The composer receives the original selected images and adjacent source-to-target homographies; it does not estimate, reorder, blend, or optimize seams.

**Coordinate convention:** Homographies use column vectors and the existing contract `H(i -> i + 1)`, mapping source image coordinates into the next target image. Therefore image 0 has `G0 = I`, and the next image is mapped back into the reference frame with `G(i + 1) = Gi * inverse(H(i -> i + 1))`. This is deliberate inversion, not a silent direction change: the pair homography points forward while the composer needs every image to point into the reference frame. Matrix composition is standard OpenCV-compatible left multiplication, so the final canvas transform is `T * Gi`, where `T` translates the global bounds by `(-minX, -minY)`.

**Bounds and negative coordinates:** The composer transforms each image's four corners, takes the minimum and maximum finite coordinates, rounds the resulting extent upward, and rejects non-positive or unreasonably large canvases. Negative global coordinates are valid; `offsetX = -minX` and `offsetY = -minY` shift all content into the positive canvas.

**Output and overlap behavior:** A successful result is `{ success, width, height, offsetX, offsetY, imageCount, composedImage }`, with `composedImage` as a PNG data URL. Images are drawn in selected-image order, so later images overwrite earlier pixels in overlaps. This is intentionally simple and is not blending or seam handling.

**Memory ownership:** Source, transform, and transformed Mats are temporary composer-owned objects and are released in `finally` for each image. The composer loads originals through the browser `Image -> canvas -> ImageData -> cv.Mat` path and never deletes caller-owned feature, match, or homography results. A failed pair returns a structured failure with its pair label rather than crashing the renderer.

**Why composition precedes blending:** Blending requires all pixels to already occupy one shared canvas. Establishing global geometry and the complete canvas first gives a future blender stable overlap regions and avoids mixing coordinate accumulation with seam, exposure, or weighting decisions.

## Known Limitations

- The application validates and previews selected images and can compose selected adjacent pairs into one global canvas, but does not yet blend or otherwise finalize them.
- OpenCV.js is available locally as a bundled runtime, and feature detection, adjacent-pair descriptor matching, RANSAC homography estimation, target-space image warping, and global canvas composition are implemented; blending and projection are not yet implemented.
- Image stitching, panorama generation, panorama projections, viewer controls, export formats, persistence, and packaging configuration do not exist yet.
- The current preload bridge exposes only a static application name to verify the boundary.
- OpenCV objects such as `cv.Mat` must be explicitly released with `.delete()` once image-processing work begins; this is a required memory-management discipline for future pipeline stages.

## Dependencies

- `electron` provides the desktop main process and browser window.
- `react` and `react-dom` provide the renderer component model and DOM rendering.
- `@adobe/react-spectrum` provides the accessible UI provider and components.
- `@techstark/opencv-js` provides the local OpenCV.js 4.9.x runtime used by the renderer.
- `vite` serves and bundles the React renderer.
- `concurrently` runs Vite and Electron together during development.
- `cross-env` sets the Electron mode consistently on Windows, macOS, and Linux.
- `wait-on` prevents Electron from opening before the Vite development server is available.

## Compatibility Considerations

- The chosen OpenCV.js package is `@techstark/opencv-js` version `4.9.0-release.3`, which aligns with the project requirement for a 4.9.x runtime and is bundled locally instead of loaded from a CDN.
- Because the renderer is sandboxed and `nodeIntegration` remains disabled, OpenCV.js must run as a browser-side WebAssembly runtime in the renderer context and cannot rely on Node-specific filesystem access.
- OpenCV initialization remains asynchronous even when the library bundle is already present in the build; the manager waits for the runtime to become ready before exposing it to the rest of the application.
