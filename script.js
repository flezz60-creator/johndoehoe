const fileInput = document.getElementById('fileInput');
const statusText = document.getElementById('statusText');
const loadingIndicator = document.getElementById('loadingIndicator');
const originalPreview = document.getElementById('originalPreview');
const resultCanvas = document.getElementById('resultCanvas');
const downloadButton = document.getElementById('downloadButton');
const resetButton = document.getElementById('resetButton');

let netPromise = null;
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
  if (!netPromise) {
    toggleLoading(true, 'Präzises Modell wird geladen … dies kann einen Moment dauern.');
    netPromise = bodyPix.load({
      architecture: 'ResNet50',
      outputStride: 16,
      quantBytes: 2,
    });
  }
  return netPromise;
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
    const net = await ensureModelLoaded();
    if (taskId !== activeTaskId) {
      return;
    }

    toggleLoading(true, 'Hintergrund wird entfernt …');

    const segmentation = await net.segmentPerson(imageElement, {
      internalResolution: 'full',
      segmentationThreshold: 0.88,
    });

    if (taskId !== activeTaskId) {
      return;
    }

    const { width, height, data: maskData } = segmentation;
    let personPixelCount = 0;
    for (let i = 0; i < maskData.length; i += 1) {
      if (maskData[i] === 1) {
        personPixelCount += 1;
      }
    }

    if (personPixelCount === 0) {
      throw new Error('Keine Person erkannt');
    }

    if (taskId !== activeTaskId) {
      return;
    }

    resultCanvas.width = width;
    resultCanvas.height = height;
    const ctx = resultCanvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(imageElement, 0, 0, width, height);

    const foregroundColor = { r: 255, g: 255, b: 255, a: 255 };
    const backgroundColor = { r: 255, g: 255, b: 255, a: 0 };
    const mask = bodyPix.toMask(segmentation, foregroundColor, backgroundColor);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.clearRect(0, 0, width, height);
    const maskBlurAmount = 8;
    bodyPix.drawMask(maskCanvas, maskCanvas, mask, 1, maskBlurAmount, false);

    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvas, 0, 0, width, height);
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
