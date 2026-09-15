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

Future processing concepts include `FeatureDetector`, `FeatureMatcher`, `ImageWarper`, `ImageBlender`, `PanoramaStitcher`, projection strategies, and `PanoramaExporter`. These OpenCV-related concepts remain architectural intentions only and are not implemented.

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

The initial file-selection workflow uses browser `File` and `URL` APIs in the React renderer. It does not use Electron filesystem APIs or upload files to a server.

## Implementation Roadmap

1. Add the image-input workflow and supported file validation. (Implemented.)
2. Add OpenCV.js loading and image-processing service boundaries. (Implemented: `OpenCVManager` and local runtime initialization.)
3. Implement feature detection, matching, warping, and blending for panorama creation. (Not done.)
4. Add cylindrical and spherical projection strategies. (Not done.)
5. Add the panorama viewer with pan, zoom, and rotation controls. (Not done.)
6. Add JPEG, PNG, and AVIF export. (Not done.)
7. Expand the preload IPC API only where desktop capabilities are required. (Not done.)
8. Add focused automated tests and production packaging configuration. (Not done.)

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

## Known Limitations

- The application validates and previews selected images, but does not yet stitch or otherwise process them.
- OpenCV.js is available locally as a bundled runtime, but processing operations such as feature detection, matching, warping, and projection are not yet implemented.
- Image stitching, OpenCV processing, panorama projections, viewer controls, export formats, persistence, and packaging configuration do not exist yet.
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
