const fileInput = document.getElementById('fileInput');
const statusText = document.getElementById('statusText');
const loadingIndicator = document.getElementById('loadingIndicator');
const originalPreview = document.getElementById('originalPreview');
const resultCanvas = document.getElementById('resultCanvas');
const downloadButton = document.getElementById('downloadButton');
const resetButton = document.getElementById('resetButton');

const refineSection = document.getElementById('refineSection');
const brushAddButton = document.getElementById('brushAddButton');
const brushEraseButton = document.getElementById('brushEraseButton');
const brushSizeInput = document.getElementById('brushSizeInput');
const brushSizeValue = document.getElementById('brushSizeValue');
const resetMaskButton = document.getElementById('resetMaskButton');

let segmenterPromise = null;
let activeTaskId = 0;

const defaultStatus = 'Wähle ein Bild, um den Hintergrund zu entfernen.';

let currentImageElement = null;
let currentFileName = null;
let maskEditorCanvas = null;
let maskEditorCtx = null;
let originalMaskImageData = null;
let editingEnabled = false;
let brushMode = 'add';
let brushSize = Number(brushSizeInput?.value) || 40;
let isPointerDrawing = false;
let lastPointerPosition = null;
let downloadUpdatePending = false;

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function toggleLoading(show, message) {
  if (show) {
    if (message) {
      const textNode = loadingIndicator.querySelector('span');
      if (textNode) {
        textNode.textContent = message;
      }
    }
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

function clearResults() {
  const ctx = resultCanvas.getContext('2d');
  ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  resultCanvas.width = resultCanvas.height = 0;
  downloadButton.classList.add('button--disabled');
  downloadButton.setAttribute('aria-disabled', 'true');
  downloadButton.removeAttribute('href');
  downloadButton.removeAttribute('download');
}

function disableManualRefinement() {
  editingEnabled = false;
  maskEditorCanvas = null;
  maskEditorCtx = null;
  originalMaskImageData = null;
  currentImageElement = null;
  currentFileName = null;
  isPointerDrawing = false;
  lastPointerPosition = null;
  downloadUpdatePending = false;
  resultCanvas.classList.remove('is-editable');
  if (refineSection) {
    refineSection.classList.add('hidden');
  }
  if (brushAddButton) {
    brushAddButton.classList.remove('refine__mode-button--active');
  }
  if (brushEraseButton) {
    brushEraseButton.classList.remove('refine__mode-button--active');
  }
}

function resetInterface(clearFileInput = true, cancelProcessing = false) {
  if (clearFileInput) {
    fileInput.value = '';
  }
  if (cancelProcessing) {
    activeTaskId += 1;
  }
  disableManualRefinement();
  originalPreview.removeAttribute('src');
  originalPreview.classList.remove('visible');
  clearResults();
  setStatus(defaultStatus);
  toggleLoading(false);
}

async function ensureModelLoaded() {
  if (!segmenterPromise) {
    toggleLoading(
      true,
      'Hochpräzises BodyPix-Modell wird geladen … dies kann einen Moment dauern.',
    );

    const { bodyPix } = window;
    if (!bodyPix) {
      toggleLoading(false);
      throw new Error('Segmentierungsbibliothek konnte nicht geladen werden.');
    }

    const config = {
      architecture: 'ResNet50',
      outputStride: 32,
      quantBytes: 4,
    };

    segmenterPromise = bodyPix
      .load(config)
      .catch((error) => {
        segmenterPromise = null;
        throw error;
      });
  }

  return segmenterPromise;
}

function dilateBinaryMask(sourceMask, width, height, iterations) {
  if (iterations <= 0) {
    return new Uint8ClampedArray(sourceMask);
  }

  let current = new Uint8ClampedArray(sourceMask);
  let next = new Uint8ClampedArray(sourceMask.length);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    next.fill(0);

    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = rowOffset + x;
        if (current[index]) {
          next[index] = 255;
          continue;
        }

        let shouldFill = false;
        for (let dy = -1; dy <= 1 && !shouldFill; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            continue;
          }
          const nRowOffset = ny * width;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) {
              continue;
            }
            if (current[nRowOffset + nx]) {
              shouldFill = true;
              break;
            }
          }
        }

        if (shouldFill) {
          next[index] = 255;
        }
      }
    }

    const temp = current;
    current = next;
    next = temp;
  }

  return current;
}

function erodeBinaryMask(sourceMask, width, height, iterations) {
  if (iterations <= 0) {
    return new Uint8ClampedArray(sourceMask);
  }

  let current = new Uint8ClampedArray(sourceMask);
  let next = new Uint8ClampedArray(sourceMask.length);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    next.fill(0);

    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = rowOffset + x;
        if (!current[index]) {
          continue;
        }

        let shouldKeep = true;
        for (let dy = -1; dy <= 1 && shouldKeep; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            shouldKeep = false;
            break;
          }
          const nRowOffset = ny * width;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) {
              shouldKeep = false;
              break;
            }
            if (!current[nRowOffset + nx]) {
              shouldKeep = false;
              break;
            }
          }
        }

        if (shouldKeep) {
          next[index] = 255;
        }
      }
    }

    const temp = current;
    current = next;
    next = temp;
  }

  return current;
}

async function createFeatheredMaskCanvas(segmentation) {
  if (!segmentation) {
    return null;
  }

  let maskImageData = null;

  if (segmentation.mask && typeof segmentation.mask.toImageData === 'function') {
    maskImageData = await segmentation.mask.toImageData();
  } else if (
    segmentation.data &&
    typeof segmentation.width === 'number' &&
    typeof segmentation.height === 'number'
  ) {
    const { width, height, data } = segmentation;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    maskImageData = tempCtx.createImageData(width, height);
    for (let i = 0; i < data.length; i += 1) {
      const offset = i * 4;
      const alpha = data[i] ? 255 : 0;
      maskImageData.data[offset] = 255;
      maskImageData.data[offset + 1] = 255;
      maskImageData.data[offset + 2] = 255;
      maskImageData.data[offset + 3] = alpha;
    }
  }

  if (!maskImageData) {
    return null;
  }

  const { width, height, data } = maskImageData;
  const totalPixels = width * height;

  const binaryMask = new Uint8ClampedArray(totalPixels);
  let foregroundPixelCount = 0;

  for (let i = 0; i < totalPixels; i += 1) {
    const alpha = data[i * 4 + 3];
    if (alpha >= 128) {
      binaryMask[i] = 255;
      foregroundPixelCount += 1;
    } else {
      binaryMask[i] = 0;
    }
  }

  if (foregroundPixelCount === 0) {
    return null;
  }

  const longestEdge = Math.max(width, height);
  const dilationIterations = Math.min(4, Math.max(1, Math.round(longestEdge / 700)));
  const erosionIterations = Math.max(1, Math.round(dilationIterations * 0.75));

  const dilatedMask = dilateBinaryMask(binaryMask, width, height, dilationIterations);
  const closedMask = erodeBinaryMask(dilatedMask, width, height, erosionIterations);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const maskImage = maskCtx.createImageData(width, height);

  for (let i = 0; i < totalPixels; i += 1) {
    const offset = i * 4;
    let alpha;
    if (closedMask[i]) {
      alpha = 255;
    } else if (binaryMask[i]) {
      alpha = 210;
    } else if (dilatedMask[i]) {
      alpha = 110;
    } else {
      alpha = 0;
    }

    maskImage.data[offset] = 255;
    maskImage.data[offset + 1] = 255;
    maskImage.data[offset + 2] = 255;
    maskImage.data[offset + 3] = alpha;
  }

  maskCtx.putImageData(maskImage, 0, 0);

  const blurRadius = Math.min(20, Math.max(6, Math.round(longestEdge / 240)));
  let outputCanvas = maskCanvas;

  if (blurRadius > 0) {
    const blurredCanvas = document.createElement('canvas');
    blurredCanvas.width = width;
    blurredCanvas.height = height;
    const blurredCtx = blurredCanvas.getContext('2d');
    if (blurredCtx) {
      blurredCtx.filter = `blur(${blurRadius}px)`;
      blurredCtx.drawImage(maskCanvas, 0, 0);
      blurredCtx.filter = 'none';
      blurredCtx.globalCompositeOperation = 'source-over';
      blurredCtx.drawImage(maskCanvas, 0, 0);
      outputCanvas = blurredCanvas;
    }
  }

  return {
    canvas: outputCanvas,
    width,
    height,
    foregroundRatio: foregroundPixelCount / totalPixels,
  };
}

function prepareMaskEditor(maskCanvas, targetWidth, targetHeight) {
  maskEditorCanvas = document.createElement('canvas');
  maskEditorCanvas.width = targetWidth;
  maskEditorCanvas.height = targetHeight;
  maskEditorCtx = maskEditorCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskEditorCtx) {
    maskEditorCanvas = null;
    return false;
  }
  maskEditorCtx.clearRect(0, 0, targetWidth, targetHeight);
  maskEditorCtx.drawImage(maskCanvas, 0, 0, targetWidth, targetHeight);
  originalMaskImageData = maskEditorCtx.getImageData(0, 0, targetWidth, targetHeight);
  return true;
}

function renderComposite() {
  if (!maskEditorCanvas || !currentImageElement) {
    return;
  }

  const width = maskEditorCanvas.width;
  const height = maskEditorCanvas.height;
  const ctx = resultCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  resultCanvas.width = width;
  resultCanvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(currentImageElement, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskEditorCanvas, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

function updateDownloadLink() {
  if (!currentFileName) {
    return;
  }
  const dataUrl = resultCanvas.toDataURL('image/png');
  downloadButton.href = dataUrl;
  downloadButton.download = `${currentFileName}-ohne-hintergrund.png`;
}

function enableManualRefinement() {
  editingEnabled = true;
  resultCanvas.classList.add('is-editable');
  if (refineSection) {
    refineSection.classList.remove('hidden');
  }
  updateBrushUI();
}

function updateBrushUI() {
  if (brushSizeValue) {
    brushSizeValue.textContent = `${Math.round(brushSize)} px`;
  }
  if (brushSizeInput && Number(brushSizeInput.value) !== brushSize) {
    brushSizeInput.value = String(Math.round(brushSize));
  }
  if (brushAddButton) {
    brushAddButton.classList.toggle(
      'refine__mode-button--active',
      brushMode === 'add',
    );
  }
  if (brushEraseButton) {
    brushEraseButton.classList.toggle(
      'refine__mode-button--active',
      brushMode === 'erase',
    );
  }
}

function setBrushMode(mode) {
  if (mode !== 'add' && mode !== 'erase') {
    return;
  }
  brushMode = mode;
  updateBrushUI();
}

function setBrushSize(size) {
  const clamped = Math.min(150, Math.max(5, size || 40));
  brushSize = clamped;
  updateBrushUI();
}

function getCanvasCoordinates(event) {
  if (!maskEditorCanvas) {
    return null;
  }

  const rect = resultCanvas.getBoundingClientRect();
  const scaleX = maskEditorCanvas.width / rect.width;
  const scaleY = maskEditorCanvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  if (Number.isNaN(x) || Number.isNaN(y)) {
    return null;
  }

  return { x, y };
}

function drawBrushStroke(from, to) {
  if (!maskEditorCtx) {
    return;
  }

  maskEditorCtx.save();
  maskEditorCtx.lineCap = 'round';
  maskEditorCtx.lineJoin = 'round';
  maskEditorCtx.globalCompositeOperation =
    brushMode === 'add' ? 'source-over' : 'destination-out';
  maskEditorCtx.strokeStyle = brushMode === 'add' ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
  maskEditorCtx.lineWidth = brushSize;
  maskEditorCtx.beginPath();
  maskEditorCtx.moveTo(from.x, from.y);
  maskEditorCtx.lineTo(to.x, to.y);
  maskEditorCtx.stroke();
  maskEditorCtx.restore();

  renderComposite();
}

function handleBrushPointerDown(event) {
  if (!editingEnabled || !maskEditorCanvas || (event.button !== 0 && event.button !== -1)) {
    return;
  }

  event.preventDefault();
  const point = getCanvasCoordinates(event);
  if (!point) {
    return;
  }

  isPointerDrawing = true;
  lastPointerPosition = point;
  downloadUpdatePending = true;

  if (typeof resultCanvas.setPointerCapture === 'function') {
    try {
      resultCanvas.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore failures to capture pointer (e.g., unsupported pointer type).
    }
  }

  drawBrushStroke(point, point);
}

function handleBrushPointerMove(event) {
  if (!isPointerDrawing || !editingEnabled) {
    return;
  }

  event.preventDefault();
  const point = getCanvasCoordinates(event);
  if (!point || !lastPointerPosition) {
    return;
  }

  drawBrushStroke(lastPointerPosition, point);
  lastPointerPosition = point;
}

function finishBrushStroke(event) {
  if (!isPointerDrawing) {
    return;
  }

  if (event) {
    event.preventDefault();
  }

  isPointerDrawing = false;
  lastPointerPosition = null;

  if (downloadUpdatePending) {
    updateDownloadLink();
    downloadUpdatePending = false;
  }

  if (typeof resultCanvas.releasePointerCapture === 'function' && event) {
    try {
      resultCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore failures to release pointer capture.
    }
  }
}

function resetMaskToOriginal() {
  if (!maskEditorCtx || !originalMaskImageData) {
    return;
  }
  maskEditorCtx.putImageData(originalMaskImageData, 0, 0);
  renderComposite();
  updateDownloadLink();
}

async function handleFileChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    return;
  }

  resetInterface(false);
  const taskId = ++activeTaskId;
  const fileName = file.name.replace(/\.[^.]+$/, '') || 'bild';

  setStatus('Bild wird geladen …');

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      originalPreview.src = reader.result;
      originalPreview.classList.add('visible');
      processImage(image, { fileName, taskId })
        .then(() => {
          if (taskId === activeTaskId) {
            fileInput.value = '';
          }
        })
        .catch((error) => {
          console.error(error);
          if (taskId === activeTaskId) {
            if (error.message === 'Keine Person erkannt') {
              setStatus(
                'Es konnte keine Person im Bild erkannt werden. Bitte wähle ein anderes Foto.',
                true,
              );
            } else {
              setStatus(
                'Ups, etwas ist schiefgelaufen. Bitte versuche es mit einem anderen Bild erneut.',
                true,
              );
            }
            clearResults();
          }
        });
    };
    image.onerror = () => {
      setStatus('Das Bild konnte nicht geladen werden.', true);
    };
    image.src = reader.result;
  };
  reader.onerror = () => {
    setStatus('Die Bilddatei konnte nicht gelesen werden.', true);
  };
  reader.readAsDataURL(file);
}

async function processImage(imageElement, { fileName, taskId }) {
  if (taskId !== activeTaskId) {
    return;
  }

  toggleLoading(true, 'Hintergrund wird entfernt …');
  setStatus('Hintergrund wird entfernt …');

  try {
    const segmenter = await ensureModelLoaded();
    if (taskId !== activeTaskId) {
      return;
    }

    toggleLoading(true, 'Hintergrund wird entfernt …');

    const segmentation = await segmenter.segmentPerson(imageElement, {
      internalResolution: 'full',
      segmentationThreshold: 0.9,
      scoreThreshold: 0.4,
      refineEdges: true,
      flipHorizontal: false,
    });

    if (taskId !== activeTaskId) {
      return;
    }

    if (!segmentation || !segmentation.data || segmentation.data.length === 0) {
      throw new Error('Keine Person erkannt');
    }

    const maskResult = await createFeatheredMaskCanvas(segmentation);

    if (!maskResult || maskResult.foregroundRatio < 0.0005) {
      throw new Error('Keine Person erkannt');
    }

    if (taskId !== activeTaskId) {
      return;
    }

    const targetWidth = imageElement.naturalWidth || imageElement.width;
    const targetHeight = imageElement.naturalHeight || imageElement.height;

    const prepared = prepareMaskEditor(maskResult.canvas, targetWidth, targetHeight);
    if (!prepared) {
      throw new Error('Maske konnte nicht vorbereitet werden');
    }

    currentImageElement = imageElement;
    currentFileName = fileName;

    renderComposite();
    enableManualRefinement();
    updateDownloadLink();

    downloadButton.classList.remove('button--disabled');
    downloadButton.removeAttribute('aria-disabled');

    setStatus('Fertig! Du kannst das Ergebnis herunterladen oder mit dem Pinsel nachbessern.');
  } finally {
    if (taskId === activeTaskId) {
      toggleLoading(false);
    }
  }
}

fileInput.addEventListener('change', handleFileChange);
resetButton.addEventListener('click', () => resetInterface(true, true));

if (brushAddButton) {
  brushAddButton.addEventListener('click', () => setBrushMode('add'));
}
if (brushEraseButton) {
  brushEraseButton.addEventListener('click', () => setBrushMode('erase'));
}
if (brushSizeInput) {
  brushSizeInput.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    setBrushSize(value);
  });
}
if (resetMaskButton) {
  resetMaskButton.addEventListener('click', resetMaskToOriginal);
}

resultCanvas.addEventListener('pointerdown', handleBrushPointerDown);
resultCanvas.addEventListener('pointermove', handleBrushPointerMove);
resultCanvas.addEventListener('pointerup', finishBrushStroke);
resultCanvas.addEventListener('pointercancel', finishBrushStroke);

setBrushMode(brushMode);
setBrushSize(brushSize);
resetInterface();
