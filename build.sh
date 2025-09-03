#!/bin/bash

# MoreLayouts Thunderbird Extension Build Script
# This script packages the extension into an XPI file for distribution

# Variables
SRC_DIR="src"
OUTPUT_DIR="dist"
EXTENSION_NAME="morelayouts-thunderbird"
VERSION="7.3"
XPI_FILE="$OUTPUT_DIR/${EXTENSION_NAME}-${VERSION}.xpi"

echo "Building MoreLayouts Thunderbird Extension..."

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Remove any existing XPI file
rm -f "$XPI_FILE"

# Create XPI file (ZIP format with .xpi extension)
echo "Creating XPI file..."
cd "$SRC_DIR"
zip -r "../$XPI_FILE" . -x "*.DS_Store" "*/.git*" "*~"
cd ..

echo "Build completed successfully!"
echo "Extension package created: $XPI_FILE"