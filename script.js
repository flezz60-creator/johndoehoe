const fileInput = document.getElementById('fileInput');
const statusText = document.getElementById('statusText');
const loadingIndicator = document.getElementById('loadingIndicator');
const originalPreview = document.getElementById('originalPreview');
const resultCanvas = document.getElementById('resultCanvas');
const downloadButton = document.getElementById('downloadButton');
const resetButton = document.getElementById('resetButton');

let segmenterPromise = null;
let activeTaskId = 0;

const defaultStatus = 'Wähle ein Bild, um den Hintergrund zu entfernen.';

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

function resetInterface(clearFileInput = true, cancelProcessing = false) {
  if (clearFileInput) {
    fileInput.value = '';
  }
  if (cancelProcessing) {
    activeTaskId += 1;
  }
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
      'Hochwertiges Segmentierungsmodell wird geladen … dies kann einen Moment dauern.',
    );

    const { bodySegmentation } = window;
    if (!bodySegmentation) {
      toggleLoading(false);
      throw new Error('Segmentierungsbibliothek konnte nicht geladen werden.');
    }

    const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
    const config = {
      runtime: 'mediapipe',
      modelType: 'general',
      solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1',
    };

    segmenterPromise = bodySegmentation
      .createSegmenter(model, config)
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

  const maskImage = await segmentation.mask.toImageData();
  const { width, height, data } = maskImage;
  const totalPixels = width * height;

  const probabilities = new Float32Array(totalPixels);
  let confidentPixelCount = 0;

  for (let i = 0; i < totalPixels; i += 1) {
    const probability = data[i * 4 + 3] / 255;
    probabilities[i] = probability;
    if (probability >= 0.35) {
      confidentPixelCount += 1;
    }
  }

  if (confidentPixelCount === 0) {
    return null;
  }

  const threshold = 0.75;
  const softness = 0.18;
  const lower = Math.max(0, threshold - softness);
  const upper = Math.min(1, threshold + softness);
  const range = upper - lower || 1;

  const softMask = new Uint8ClampedArray(totalPixels);
  const binaryMask = new Uint8ClampedArray(totalPixels);

  for (let i = 0; i < totalPixels; i += 1) {
    const probability = probabilities[i];
    let weight;
    if (probability <= lower) {
      weight = 0;
    } else if (probability >= upper) {
      weight = 1;
    } else {
      const normalized = (probability - lower) / range;
      weight = Math.pow(Math.min(Math.max(normalized, 0), 1), 0.75);
    }

    const blended = Math.max(weight, Math.min(probability, 1));
    const alpha = Math.round(Math.min(Math.max(blended, 0), 1) * 255);
    softMask[i] = alpha;
    binaryMask[i] = alpha >= 150 ? 255 : 0;
  }

  const longestEdge = Math.max(width, height);
  const dilationIterations = Math.min(4, Math.max(1, Math.round(longestEdge / 700)));
  const erosionIterations = Math.max(1, Math.round(dilationIterations * 0.75));

  const dilatedMask = dilateBinaryMask(binaryMask, width, height, dilationIterations);
  const closedMask = erodeBinaryMask(dilatedMask, width, height, erosionIterations);

  let foregroundPixelCount = 0;
  for (let i = 0; i < totalPixels; i += 1) {
    if (closedMask[i]) {
      foregroundPixelCount += 1;
      softMask[i] = Math.max(softMask[i], 210);
    } else {
      softMask[i] = Math.min(softMask[i], 10);
    }
  }

  if (foregroundPixelCount === 0) {
    return null;
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) {
    return null;
  }

  const maskImageData = maskCtx.createImageData(width, height);
  for (let i = 0; i < totalPixels; i += 1) {
    const offset = i * 4;
    const alpha = softMask[i];
    maskImageData.data[offset] = 255;
    maskImageData.data[offset + 1] = 255;
    maskImageData.data[offset + 2] = 255;
    maskImageData.data[offset + 3] = alpha;
  }

  maskCtx.putImageData(maskImageData, 0, 0);

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
      outputCanvas = blurredCanvas;
    }
  }

  const foregroundRatio = foregroundPixelCount / totalPixels;

  return {
    canvas: outputCanvas,
    width,
    height,
    foregroundRatio,
  };
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

    const segmentations = await segmenter.segmentPeople(imageElement);

    if (taskId !== activeTaskId) {
      return;
    }

    if (!segmentations || segmentations.length === 0) {
      throw new Error('Keine Person erkannt');
    }

    const maskResult = await createFeatheredMaskCanvas(segmentations[0]);

    if (!maskResult || maskResult.foregroundRatio < 0.0005) {
      throw new Error('Keine Person erkannt');
    }

    if (taskId !== activeTaskId) {
      return;
    }

    const targetWidth = imageElement.naturalWidth || imageElement.width;
    const targetHeight = imageElement.naturalHeight || imageElement.height;

    resultCanvas.width = targetWidth;
    resultCanvas.height = targetHeight;
    const ctx = resultCanvas.getContext('2d');
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(imageElement, 0, 0, targetWidth, targetHeight);

    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskResult.canvas, 0, 0, targetWidth, targetHeight);
    ctx.globalCompositeOperation = 'source-over';

    const dataUrl = resultCanvas.toDataURL('image/png');
    downloadButton.href = dataUrl;
    downloadButton.download = `${fileName}-ohne-hintergrund.png`;
    downloadButton.classList.remove('button--disabled');
    downloadButton.removeAttribute('aria-disabled');

    setStatus('Fertig! Lade dein Bild ohne Hintergrund herunter.');
  } finally {
    if (taskId === activeTaskId) {
      toggleLoading(false);
    }
  }
}

fileInput.addEventListener('change', handleFileChange);
resetButton.addEventListener('click', () => resetInterface(true, true));

resetInterface();
