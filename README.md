# Zebra Printer Label Viewer (Static Version)

A static web application for viewing Zebra Printer Labels (ZPL) and reading barcodes.

## Features

- **ZPL Generation**: Render ZPL code into images using the Labelary API.
- **Barcode Reading**: Scan and decode barcodes from uploaded images or PDFs using ZXing.
- **Zebra File PDF Extraction**: Extract ZPL code from PDFs and generate labels.
- **PDF Generation**: Download multiple labels as a single 4x6 PDF.
- **No Backend Required**: Runs entirely in the browser.

## Tech Stack

- **HTML/CSS/JS**
- **Labelary API**: For ZPL rendering.
- **ZXing**: For client-side barcode scanning.
- **PDF.js**: For PDF processing.
- **jsPDF**: For PDF generation.

## How to Run

Simply open `public/index.html` in any modern web browser.
