# MoreLayouts Thunderbird Extension Makefile
# This Makefile packages the extension into an XPI file for distribution

# Variables
SRC_DIR = src
OUTPUT_DIR = dist
EXTENSION_NAME = morelayouts-thunderbird
VERSION = 7.3
XPI_FILE = $(OUTPUT_DIR)/$(EXTENSION_NAME)-$(VERSION).xpi

# Default target
.PHONY: all
all: build

# Build the extension
.PHONY: build
build:
	@echo "Building MoreLayouts Thunderbird Extension..."
	@mkdir -p $(OUTPUT_DIR)
	@rm -f $(XPI_FILE)
	@cd $(SRC_DIR) && zip -r ../$(XPI_FILE) . -x "*.DS_Store" "*/.git*" "*~"
	@echo "Build completed successfully!"
	@echo "Extension package created: $(XPI_FILE)"

# Clean build artifacts
.PHONY: clean
clean:
	@rm -rf $(OUTPUT_DIR)
	@echo "Cleaned build artifacts."

# Install the extension (for development)
.PHONY: install
install: build
	@echo "Install the extension by loading $(XPI_FILE) in Thunderbird"