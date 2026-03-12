// Initialize PDF.js
const pdfjsLib = window["pdfjs-dist/build/pdf"];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let currentImageUrl = null;
let selectedFile = null;
let zebraFile = null;
let generatedLabels = [];
let currentLabelIndex = 0;

function createCodeReader() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true);
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.QR_CODE,
    ZXing.BarcodeFormat.DATA_MATRIX,
    ZXing.BarcodeFormat.PDF_417,
    ZXing.BarcodeFormat.AZTEC,
  ]);
  return new ZXing.BrowserMultiFormatReader(hints);
}

function createAdditionalReaders() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true);

  const readers = [];
  if (typeof ZXing.BrowserQRCodeReader === "function") {
    readers.push(new ZXing.BrowserQRCodeReader(hints));
  }
  if (typeof ZXing.BrowserDatamatrixCodeReader === "function") {
    readers.push(new ZXing.BrowserDatamatrixCodeReader(hints));
  }
  if (typeof ZXing.BrowserPDF417Reader === "function") {
    readers.push(new ZXing.BrowserPDF417Reader(hints));
  }
  if (typeof ZXing.BrowserAztecCodeReader === "function") {
    readers.push(new ZXing.BrowserAztecCodeReader(hints));
  }
  return readers;
}

function getAllReaders() {
  const readers = [createCodeReader()];
  return readers.concat(createAdditionalReaders());
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}

async function decodeWithUpscale(dataUrl, reader) {
  const img = await loadImage(dataUrl);
  const minTarget = 900;
  const scale = Math.max(1, minTarget / Math.min(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (typeof reader.decodeFromCanvas === "function") {
    return reader.decodeFromCanvas(canvas);
  }
  return reader.decodeFromImageElement(img);
}

function pushUniqueResult(result, bucket) {
  if (!result) return;
  const key = `${result.getBarcodeFormat()}|${result.getText()}`;
  if (!bucket.has(key)) {
    bucket.set(key, result);
  }
}

function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function applyHighContrast(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const v = 0.299 * r + 0.587 * g + 0.114 * b;
    const boosted = v < 128 ? 0 : 255;
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
  ctx.putImageData(imgData, 0, 0);
}

function applyInvert(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  ctx.putImageData(imgData, 0, 0);
}

function buildWholeImageVariants(canvas) {
  const variants = [];
  variants.push(canvas);
  const highContrast = cloneCanvas(canvas);
  applyHighContrast(highContrast);
  variants.push(highContrast);
  const inverted = cloneCanvas(highContrast);
  applyInvert(inverted);
  variants.push(inverted);
  return variants;
}

function getBoundingBox(points) {
  if (!points || points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p) => {
    const x = p.getX();
    const y = p.getY();
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function maskResultArea(canvas, result) {
  const points = result.getResultPoints();
  const box = getBoundingBox(points);
  if (!box) return false;
  const pad = Math.max(12, Math.round(Math.max(box.w, box.h) * 0.25));
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const w = Math.min(canvas.width - x, Math.ceil(box.w + pad * 2));
  const h = Math.min(canvas.height - y, Math.ceil(box.h + pad * 2));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  return true;
}

async function tryDecodeWholeCanvas(canvas, reader) {
  if (typeof reader.decodeMultipleFromCanvas === "function") {
    return reader.decodeMultipleFromCanvas(canvas);
  }
  if (typeof reader.decodeFromCanvas === "function") {
    return [await reader.decodeFromCanvas(canvas)];
  }
  const dataUrl = canvas.toDataURL("image/png");
  const img = await loadImage(dataUrl);
  if (typeof reader.decodeMultipleFromImageElement === "function") {
    return reader.decodeMultipleFromImageElement(img);
  }
  return [await reader.decodeFromImageElement(img)];
}

async function decodeIteratively(canvas, reader, maxPasses = 8) {
  const resultsMap = new Map();
  const working = cloneCanvas(canvas);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let result = null;
    try {
      const resArr = await tryDecodeWholeCanvas(working, reader);
      result = resArr && resArr.length > 0 ? resArr[0] : null;
    } catch (_e) {
      result = null;
    }
    if (!result) break;
    pushUniqueResult(result, resultsMap);
    const masked = maskResultArea(working, result);
    if (!masked) break;
  }
  return Array.from(resultsMap.values());
}

function createCroppedCanvas(sourceCanvas, x, y, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sourceCanvas,
    x,
    y,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

async function decodeByTiling(canvas, reader, resultsMap) {
  const minDim = Math.min(canvas.width, canvas.height);
  const tileSize = Math.max(200, Math.round(minDim * 0.45));
  const step = Math.max(120, Math.round(tileSize * 0.5));
  let tiles = 0;
  const maxTiles = 64;

  for (let y = 0; y <= canvas.height - 1 && tiles < maxTiles; y += step) {
    for (let x = 0; x <= canvas.width - 1 && tiles < maxTiles; x += step) {
      const w = Math.min(tileSize, canvas.width - x);
      const h = Math.min(tileSize, canvas.height - y);
      const tile = createCroppedCanvas(canvas, x, y, w, h);
      tiles += 1;
      try {
        const results = await tryDecodeWholeCanvas(tile, reader);
        if (results && results.length > 0) {
          results.forEach((res) => pushUniqueResult(res, resultsMap));
        }
      } catch (_e) {
        // continue
      }
    }
  }
}

async function decodeAllFromCanvas(canvas, reader) {
  if (typeof reader.decodeMultipleFromCanvas === "function") {
    return reader.decodeMultipleFromCanvas(canvas);
  }

  const resultsMap = new Map();
  const variants = buildWholeImageVariants(canvas);
  const readers = getAllReaders();
  for (const variant of variants) {
    for (const activeReader of readers) {
      try {
        const multi = await tryDecodeWholeCanvas(variant, activeReader);
        if (multi && multi.length > 1) {
          multi.forEach((res) => pushUniqueResult(res, resultsMap));
          continue;
        }
        const iterResults = await decodeIteratively(variant, activeReader);
        if (iterResults.length > 0) {
          iterResults.forEach((res) => pushUniqueResult(res, resultsMap));
        } else if (multi && multi.length === 1) {
          pushUniqueResult(multi[0], resultsMap);
        }
        if (resultsMap.size < 2) {
          await decodeByTiling(variant, activeReader, resultsMap);
        }
      } catch (_e) {
        // Try the next reader/variant
      }
    }
  }

  return Array.from(resultsMap.values());
}

async function decodeAllFromDataUrl(dataUrl, reader) {
  const img = await loadImage(dataUrl);
  const minTarget = 2000;
  const scale = Math.max(1, minTarget / Math.min(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (typeof reader.decodeMultipleFromCanvas === "function") {
    return reader.decodeMultipleFromCanvas(canvas);
  }

  return decodeAllFromCanvas(canvas, reader);
}

async function decodeCanvas(canvas, reader) {
  if (typeof reader.decodeFromCanvas === "function") {
    return reader.decodeFromCanvas(canvas);
  }
  const dataUrl = canvas.toDataURL("image/png");
  return decodeWithUpscale(dataUrl, reader);
}

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.remove("active");
  });
  const btn = document.querySelector(
    `.tab-button[onclick="switchTab('${tabName}')"]`,
  );
  if (btn) btn.classList.add("active");

  // Update tab content
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.remove("active");
  });
  const content = document.getElementById(`${tabName}Tab`);
  if (content) content.classList.add("active");

  // Clear previous results
  clearBarcodeResults();
  document.getElementById("errorMessage").textContent = "";
  document.getElementById("labelImage").style.display = "none";
}

function handleFileUpload() {
  const fileInput = document.getElementById("fileInput");
  const readFileBarcodesButton = document.getElementById(
    "readFileBarcodesButton",
  );
  const errorMessage = document.getElementById("errorMessage");

  selectedFile = fileInput.files[0];
  errorMessage.textContent = "";

  if (selectedFile) {
    const validTypes = ["application/pdf", "image/png", "image/jpeg"];
    if (validTypes.includes(selectedFile.type)) {
      readFileBarcodesButton.style.display = "block";
    } else {
      errorMessage.textContent =
        "Invalid file type. Please upload a PDF or image file.";
      readFileBarcodesButton.style.display = "none";
      selectedFile = null;
      fileInput.value = "";
    }
  } else {
    readFileBarcodesButton.style.display = "none";
  }
}

async function readFileBarcodesButton() {
  if (!selectedFile) {
    document.getElementById("errorMessage").textContent =
      "Please select a file first.";
    return;
  }

  const barcodeResults = document.getElementById("barcodeResults");
  const barcodeList = document.getElementById("barcodeList");
  const barcodeError = document.getElementById("barcodeError");
  const labelImage = document.getElementById("labelImage");

  // Clear previous results
  clearBarcodeResults();
  barcodeError.textContent = "";
  labelImage.style.display = "none";

  // Show loading state
  barcodeResults.style.display = "block";
  barcodeList.innerHTML = '<div class="loading">Reading barcodes...</div>';

  try {
    let imagesToScan = [];

    if (selectedFile.type === "application/pdf") {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      // For simplicity, we'll process all pages
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 5.0 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport })
          .promise;
        imagesToScan.push({
          dataUrl: canvas.toDataURL("image/png"),
          page: i,
          canvas,
        });

        if (i === 1) {
          labelImage.src = imagesToScan[0].dataUrl;
          labelImage.style.display = "block";
        }
      }
    } else {
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(selectedFile);
      });
      imagesToScan.push({ dataUrl, page: null });
      labelImage.src = dataUrl;
      labelImage.style.display = "block";
    }

    const allBarcodes = [];
    const codeReader = createCodeReader();

    for (const item of imagesToScan) {
      try {
        const results = item.canvas
          ? await decodeAllFromCanvas(item.canvas, codeReader)
          : await decodeAllFromDataUrl(item.dataUrl, codeReader);
        if (results && results.length > 0) {
          results.forEach((res) => {
            const points = res.getResultPoints();
            const firstPoint = points && points.length > 0 ? points[0] : null;
            const barcode = {
              data: res.getText(),
              type: res.getBarcodeFormat(),
              page: item.page,
              location: {
                x: firstPoint ? firstPoint.getX() : "?",
                y: firstPoint ? firstPoint.getY() : "?",
                width: "?",
                height: "?",
              },
            };
            allBarcodes.push(barcode);
          });
        }
      } catch (e) {
        console.log("No barcode on page", item.page, e);
      }
    }

    // Display results
    if (allBarcodes.length > 0) {
      barcodeList.innerHTML = "";
      allBarcodes.forEach((barcode, index) => {
        const barcodeItem = document.createElement("div");
        barcodeItem.className = "barcode-item";
        barcodeItem.innerHTML = `
                    <div class="barcode-header">
                        <strong>Barcode ${index + 1}</strong>
                        <span class="barcode-type">${barcode.type}</span>
                        ${barcode.page ? `<span class="barcode-page">Page ${barcode.page}</span>` : ""}
                    </div>
                    <div class="barcode-data">${barcode.data}</div>
                `;
        barcodeList.appendChild(barcodeItem);
      });
    } else {
      barcodeList.innerHTML =
        '<div class="no-barcodes">No barcodes found in the file</div>';
    }
  } catch (error) {
    barcodeError.textContent = `Error reading barcodes: ${error.message}`;
    barcodeList.innerHTML = "";
  }
}

async function generateLabel() {
  const zplInput = document.getElementById("zplInput").value;
  const labelImage = document.getElementById("labelImage");
  const errorMessage = document.getElementById("errorMessage");
  const downloadButton = document.getElementById("downloadButton");
  const readBarcodesButton = document.getElementById("readBarcodesButton");

  // Clear previous output
  labelImage.style.display = "none";
  errorMessage.textContent = "";
  downloadButton.style.display = "none";
  readBarcodesButton.style.display = "none";
  clearBarcodeResults();

  if (currentImageUrl) {
    URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = null;
  }

  try {
    const response = await fetch(
      "http://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/",
      {
        method: "POST",
        headers: {
          Accept: "image/png",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: zplInput,
      },
    );

    if (!response.ok) {
      throw new Error(`Labelary Error: ${response.statusText}`);
    }
    const blob = await response.blob();
    currentImageUrl = URL.createObjectURL(blob);
    labelImage.src = currentImageUrl;
    labelImage.style.display = "block";
    downloadButton.style.display = "block";
    readBarcodesButton.style.display = "block";
  } catch (error) {
    errorMessage.textContent = `Error generating label: ${error.message}`;
  }
}

async function readBarcodes() {
  const labelImage = document.getElementById("labelImage");
  const barcodeResults = document.getElementById("barcodeResults");
  const barcodeList = document.getElementById("barcodeList");
  const barcodeError = document.getElementById("barcodeError");

  if (!labelImage.src) return;

  // Clear previous results
  clearBarcodeResults();
  barcodeError.textContent = "";

  // Show loading state
  barcodeResults.style.display = "block";
  barcodeList.innerHTML = '<div class="loading">Reading barcodes...</div>';

  try {
    const codeReader = createCodeReader();
    const results = await decodeAllFromDataUrl(labelImage.src, codeReader);

    if (results && results.length > 0) {
      barcodeList.innerHTML = "";
      results.forEach((res, index) => {
        const barcodeItem = document.createElement("div");
        barcodeItem.className = "barcode-item";
        barcodeItem.innerHTML = `
                <div class="barcode-header">
                    <strong>Barcode ${index + 1}</strong>
                    <span class="barcode-type">${res.getBarcodeFormat()}</span>
                </div>
                <div class="barcode-data">${res.getText()}</div>
            `;
        barcodeList.appendChild(barcodeItem);
      });
    } else {
      barcodeList.innerHTML =
        '<div class="no-barcodes">No barcodes found in the label</div>';
    }
  } catch (error) {
    barcodeError.textContent = `No barcodes found or error: ${error.message}`;
    barcodeList.innerHTML = "";
  }
}

function clearBarcodeResults() {
  const barcodeResults = document.getElementById("barcodeResults");
  const barcodeList = document.getElementById("barcodeList");

  if (barcodeResults) {
    barcodeResults.style.display = "none";
  }
  if (barcodeList) {
    barcodeList.innerHTML = "";
  }
}

function downloadLabel() {
  if (currentImageUrl) {
    const link = document.createElement("a");
    link.href = currentImageUrl;
    link.download = "label.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Zebra File Upload Tab Functions
function handleZebraFileUpload() {
  const fileInput = document.getElementById("zebraFileInput");
  const generateButton = document.getElementById("generateFromPdfButton");
  const errorMessage = document.getElementById("errorMessage");

  zebraFile = fileInput.files[0];
  errorMessage.textContent = "";

  if (zebraFile) {
    if (zebraFile.type === "application/pdf") {
      generateButton.style.display = "block";
    } else {
      errorMessage.textContent = "Invalid file type. Please upload a PDF file.";
      generateButton.style.display = "none";
      zebraFile = null;
      fileInput.value = "";
    }
  } else {
    generateButton.style.display = "none";
  }
}

async function generateLabelsFromPdf() {
  if (!zebraFile) {
    document.getElementById("errorMessage").textContent =
      "Please select a PDF file first.";
    return;
  }

  const errorMessage = document.getElementById("errorMessage");
  const labelImage = document.getElementById("labelImage");
  const generateButton = document.getElementById("generateFromPdfButton");
  const readBarcodesButton = document.getElementById("readZebraBarcodesButton");
  const downloadAllButton = document.getElementById("downloadAllLabelsButton");
  const labelNavigation = document.getElementById("labelNavigation");

  // Clear previous results
  errorMessage.textContent = "";
  labelImage.style.display = "none";
  clearBarcodeResults();
  generatedLabels = [];
  currentLabelIndex = 0;

  // Show loading state
  generateButton.disabled = true;
  generateButton.textContent = "Generating...";

  try {
    const originalBuffer = await zebraFile.arrayBuffer();
    // Use a slice/clone to avoid detaching the main buffer
    const pdf = await pdfjsLib.getDocument({
      data: originalBuffer.slice(0),
    }).promise;

    // Try text extraction first
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item) => item.str).join(" ");

      if (text.toUpperCase().includes("^XA")) {
        const zpl = text.trim();
        const response = await fetch(
          "http://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/",
          {
            method: "POST",
            headers: {
              Accept: "image/png",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: zpl,
          },
        );
        if (response.ok) {
          const blob = await response.blob();
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
          generatedLabels.push({ page: i, zpl: zpl, image: dataUrl });
        }
      }
    }

    // If no labels found via text extraction, try raw binary search
    if (generatedLabels.length === 0) {
      const decoder = new TextDecoder("ascii");
      const fullText = decoder.decode(new Uint8Array(originalBuffer));

      // Match ZPL blocks: ^XA ... ^XZ
      const zplRegex = /\^XA[\s\S]*?\^XZ/gi;
      let matches = fullText.match(zplRegex);

      if (!matches) {
        // Try looking for markers separately
        const xaIndices = [];
        let xaIdx = fullText.toUpperCase().indexOf("^XA");
        while (xaIdx !== -1) {
          xaIndices.push(xaIdx);
          xaIdx = fullText.toUpperCase().indexOf("^XA", xaIdx + 3);
        }

        matches = xaIndices
          .map((start) => {
            let end = fullText.toUpperCase().indexOf("^XZ", start);
            if (end !== -1) {
              return fullText.substring(start, end + 3);
            }
            return null;
          })
          .filter((m) => m !== null);
      }

      if (!matches || matches.length === 0) {
        // Try a more aggressive split
        matches = fullText
          .split(/\^XZ/i)
          .filter((part) => part.toUpperCase().includes("^XA"))
          .map((part) => {
            const start = part.toUpperCase().indexOf("^XA");
            return part.substring(start) + "^XZ";
          });
      }

      if (matches && matches.length > 0) {
        for (const zpl of matches) {
          const response = await fetch(
            "http://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/",
            {
              method: "POST",
              headers: {
                Accept: "image/png",
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: zpl,
            },
          );
          if (response.ok) {
            const blob = await response.blob();
            const dataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            generatedLabels.push({
              page: "Extracted",
              zpl: zpl,
              image: dataUrl,
            });
          }
        }
      }
    }

    if (generatedLabels.length === 0) {
      throw new Error("No ZPL codes found in the PDF");
    }

    currentLabelIndex = 0;
    displayCurrentLabel();

    readBarcodesButton.style.display = "block";
    downloadAllButton.style.display = "block";

    if (generatedLabels.length > 1) {
      labelNavigation.style.display = "flex";
      updateNavigationButtons();
    }
  } catch (error) {
    errorMessage.textContent = `Error generating labels: ${error.message}`;
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "Generate Labels";
  }
}

function displayCurrentLabel() {
  const labelImage = document.getElementById("labelImage");
  const labelCounter = document.getElementById("labelCounter");

  if (
    generatedLabels.length > 0 &&
    currentLabelIndex < generatedLabels.length
  ) {
    const currentLabel = generatedLabels[currentLabelIndex];
    labelImage.src = currentLabel.image;
    labelImage.style.display = "block";
    labelCounter.textContent = `Label ${currentLabelIndex + 1} of ${generatedLabels.length}`;
  }
}

function previousLabel() {
  if (currentLabelIndex > 0) {
    currentLabelIndex--;
    displayCurrentLabel();
    updateNavigationButtons();
    clearBarcodeResults();
  }
}

function nextLabel() {
  if (currentLabelIndex < generatedLabels.length - 1) {
    currentLabelIndex++;
    displayCurrentLabel();
    updateNavigationButtons();
    clearBarcodeResults();
  }
}

function updateNavigationButtons() {
  const prevButton = document.getElementById("prevLabelButton");
  const nextButton = document.getElementById("nextLabelButton");

  prevButton.disabled = currentLabelIndex === 0;
  nextButton.disabled = currentLabelIndex === generatedLabels.length - 1;
}

async function readZebraBarcodes() {
  if (
    generatedLabels.length === 0 ||
    currentLabelIndex >= generatedLabels.length
  ) {
    document.getElementById("errorMessage").textContent =
      "No label to read barcodes from.";
    return;
  }

  const barcodeResults = document.getElementById("barcodeResults");
  const barcodeList = document.getElementById("barcodeList");
  const barcodeError = document.getElementById("barcodeError");

  clearBarcodeResults();
  barcodeError.textContent = "";

  barcodeResults.style.display = "block";
  barcodeList.innerHTML = '<div class="loading">Reading barcodes...</div>';

  try {
    const currentLabel = generatedLabels[currentLabelIndex];
    const codeReader = createCodeReader();
    const results = await decodeAllFromDataUrl(currentLabel.image, codeReader);

    if (results && results.length > 0) {
      barcodeList.innerHTML = "";
      results.forEach((res, index) => {
        const barcodeItem = document.createElement("div");
        barcodeItem.className = "barcode-item";
        barcodeItem.innerHTML = `
                <div class="barcode-header">
                    <strong>Barcode ${index + 1}</strong>
                    <span class="barcode-type">${res.getBarcodeFormat()}</span>
                </div>
                <div class="barcode-data">${res.getText()}</div>
            `;
        barcodeList.appendChild(barcodeItem);
      });
    } else {
      barcodeList.innerHTML =
        '<div class="no-barcodes">No barcodes found in the label</div>';
    }
  } catch (error) {
    barcodeError.textContent = `No barcodes found or error: ${error.message}`;
    barcodeList.innerHTML = "";
  }
}

async function downloadAllLabels() {
  if (generatedLabels.length === 0) {
    document.getElementById("errorMessage").textContent =
      "No labels to download.";
    return;
  }

  const downloadButton = document.getElementById("downloadAllLabelsButton");
  downloadButton.disabled = true;
  downloadButton.textContent = "Generating PDF...";

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: [288, 432],
    });

    generatedLabels.forEach((label, index) => {
      if (index > 0) doc.addPage([288, 432], "portrait");
      doc.addImage(label.image, "PNG", 0, 0, 288, 432);
    });

    doc.save("zebra_labels.pdf");
  } catch (error) {
    document.getElementById("errorMessage").textContent =
      `Error downloading PDF: ${error.message}`;
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Download All as PDF";
  }
}
