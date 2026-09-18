import React from 'react';
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

console.log('[DIAG] App.jsx executed');

function App() {
  const appName = window.electronAPI?.appName ?? 'Panora';
  const [opencvState, setOpenCVState] = useState(openCVManager.getState());

  useEffect(() => {
    console.log('[DIAG] App mounted');
    setTimeout(() => console.log('[DIAG] renderer responsive'), 0);
    const unsubscribe = openCVManager.subscribe((state) => {
      console.log(`[DIAG] App received OpenCV state: ${state}`);
      console.log(`[DIAG] App calling setOpenCVState: ${state}`);
      setOpenCVState(state);
    });
    console.log('[DIAG] App subscribed to OpenCV manager');
    openCVManager.initialize().then(() => {
      const state = openCVManager.getState();
      console.log(`[DIAG] App initialization resolved with state: ${state}`);
      console.log(`[DIAG] App calling setOpenCVState: ${state}`);
      setOpenCVState(state);
    }).catch(() => {
      // The app remains usable without OpenCV; errors are surfaced in the UI.
    });

    return unsubscribe;
  }, []);

  const openCVStatus = useMemo(() => ({
    label: OPEN_CV_LABELS[opencvState] ?? 'Initializing...',
    variant: OPEN_CV_VARIANTS[opencvState] ?? 'notice'
  }), [opencvState]);

  useEffect(() => {
    console.log('[DIAG] App opencvState rendered:', opencvState);
  }, [opencvState]);

  console.log('[DIAG] OpenCV UI label:', openCVStatus.label);

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