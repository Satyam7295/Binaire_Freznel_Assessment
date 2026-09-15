import { Flex, Heading, StatusLight, Text, View } from '@adobe/react-spectrum';
import { useEffect, useMemo, useState } from 'react';
import openCVManager, { OPEN_CV_STATES } from '../services/OpenCVManager.js';
import ImageInputPanel from './ImageInputPanel.jsx';

const OPEN_CV_LABELS = {
  [OPEN_CV_STATES.IDLE]: 'Initializing...',
  [OPEN_CV_STATES.LOADING]: 'Initializing...',
  [OPEN_CV_STATES.READY]: 'Ready',
  [OPEN_CV_STATES.FAILED]: 'Unavailable'
};

const OPEN_CV_VARIANTS = {
  [OPEN_CV_STATES.IDLE]: 'notice',
  [OPEN_CV_STATES.LOADING]: 'notice',
  [OPEN_CV_STATES.READY]: 'positive',
  [OPEN_CV_STATES.FAILED]: 'negative'
};

function App() {
  const appName = window.electronAPI?.appName ?? 'Panora';
  const [opencvState, setOpenCVState] = useState(openCVManager.getState());

  useEffect(() => {
    const unsubscribe = openCVManager.subscribe(setOpenCVState);
    openCVManager.initialize().catch(() => {
      // The app remains usable without OpenCV; errors are surfaced in the UI.
    });

    return unsubscribe;
  }, []);

  const openCVStatus = useMemo(() => ({
    label: OPEN_CV_LABELS[opencvState] ?? 'Initializing...',
    variant: OPEN_CV_VARIANTS[opencvState] ?? 'notice'
  }), [opencvState]);

  return (
    <main className="app-shell">
      <View width="100%" maxWidth="size-6000">
        <Heading level={1}>{appName}</Heading>
        <Text>Application foundation ready.</Text>

        <View backgroundColor="gray-100" borderRadius="medium" padding="size-250" marginTop="size-250" width="fit-content">
          <Flex direction="row" gap="size-100" alignItems="center">
            <Text>OpenCV</Text>
            <StatusLight variant={openCVStatus.variant}>{openCVStatus.label}</StatusLight>
          </Flex>
        </View>

        <ImageInputPanel />
      </View>
    </main>
  );
}

export default App;