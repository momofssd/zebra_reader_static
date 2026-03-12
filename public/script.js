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
        const viewport = page.getViewport({ scale: 2.0 });
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
          ? await decodeCanvas(item.canvas, codeReader)
          : await decodeWithUpscale(item.dataUrl, codeReader);
        if (results) {
          const barcode = {
            data: results.getText(),
            type: results.getBarcodeFormat(),
            page: item.page,
            location: {
              x: results.getResultPoints()[0].getX(),
              y: results.getResultPoints()[0].getY(),
              width: "?",
              height: "?",
            },
          };
          allBarcodes.push(barcode);
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
    const result = await decodeWithUpscale(labelImage.src, codeReader);

    if (result) {
      barcodeList.innerHTML = "";
      const barcodeItem = document.createElement("div");
      barcodeItem.className = "barcode-item";
      barcodeItem.innerHTML = `
                <div class="barcode-header">
                    <strong>Barcode 1</strong>
                    <span class="barcode-type">${result.getBarcodeFormat()}</span>
                </div>
                <div class="barcode-data">${result.getText()}</div>
            `;
      barcodeList.appendChild(barcodeItem);
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
    const result = await decodeWithUpscale(currentLabel.image, codeReader);

    if (result) {
      barcodeList.innerHTML = "";
      const barcodeItem = document.createElement("div");
      barcodeItem.className = "barcode-item";
      barcodeItem.innerHTML = `
                <div class="barcode-header">
                    <strong>Barcode 1</strong>
                    <span class="barcode-type">${result.getBarcodeFormat()}</span>
                </div>
                <div class="barcode-data">${result.getText()}</div>
            `;
      barcodeList.appendChild(barcodeItem);
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
