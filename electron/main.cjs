const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const isDevelopment = process.env.NODE_ENV !== 'production' && !app.isPackaged;
let mainWindow;

console.log('[DIAG] Electron main process executed');

const imageMimeTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.avif', 'image/avif']
]);

ipcMain.handle('select-images', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'avif'] }]
  });

  if (result.canceled) {
    return { canceled: true, filePaths: [], files: [] };
  }

  const files = await Promise.all(result.filePaths.map(async (filePath) => {
    const extension = path.extname(filePath).toLowerCase();
    const [data, stats] = await Promise.all([
      fs.readFile(filePath),
      fs.stat(filePath)
    ]);

    return {
      name: path.basename(filePath),
      type: imageMimeTypes.get(extension) ?? 'application/octet-stream',
      lastModified: stats.mtimeMs,
      data: data.toString('base64')
    };
  }));

  return { canceled: false, filePaths: result.filePaths, files };
});

function createWindow() {
  console.log('[DIAG] BrowserWindow creating');
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (isDevelopment) {
    console.log('[DIAG] Loading Vite URL: http://127.0.0.1:5173');
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    console.log('[DIAG] Loading production index');
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => console.log('[DIAG] BrowserWindow finished loading'));
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('[DIAG] renderer console', { level, message, line, sourceId });
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[DIAG] BrowserWindow failed to load', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  console.log('[DIAG] Electron app ready');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});