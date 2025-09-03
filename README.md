# MoreLayouts Thunderbird Extension

More Layouts Thunderbird Extension - A Thunderbird add-on that provides additional layout options.

## Overview

This extension adds additional layout options to Thunderbird, including:
- Wide Thread View
- Stacked View
- Reversed views
- Configurable Fullscreen F11 and Message Pane F8 toggles
- Vertical Tabs

## Features

- Adds additional Wide Thread View and Stacked View to Thunderbird along with Reversed views
- Includes configurable Fullscreen F11 and Message Pane F8 toggles
- Features Vertical Tabs
- Compatible with Thunderbird 102.0a1 - 140.*

## Installation

1. Download the XPI file from the releases page
2. Open Thunderbird
3. Go to Add-ons Manager (Ctrl+Shift+A)
4. Click the gear icon and select "Install Add-on From File"
5. Select the downloaded XPI file

## Development

This repository contains the source code for the MoreLayouts Thunderbird extension.

### Project Structure

```
MoreLayouts-Thunderbird-Extension/
├── src/
│   ├── manifest.json
│   ├── background.js
│   ├── experiments.js
│   ├── schema.json
│   ├── content/
│   │   ├── morelayouts.js
│   │   ├── options.html
│   │   └── options.js
│   ├── skin/
│   │   ├── layout64.png
│   │   ├── layout64.svg
│   │   ├── morelayouts-compose.css
│   │   ├── morelayouts.css
│   │   ├── morelayouts7.css
│   │   └── options.css
│   └── _locales/
│       ├── en/
│       ├── de/
│       └── fr/
├── scripts/
│   └── build.js
├── dist/
├── docs/
├── tests/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── Makefile
├── package.json
├── build.sh
└── build-extension.bat
```

### Building

You can build the extension using several methods:

#### Method 1: Using Node.js (Recommended)

1. Install dependencies: `npm install`
2. Build the extension: `npm run build`

This will create a packaged XPI file in the `dist/` directory.

#### Method 2: Using the Makefile

1. Run: `make build`

#### Method 3: Using the batch script (Windows)

1. Run: `build-extension.bat`

#### Method 4: Using the shell script (Unix-like systems)

1. Make the script executable: `chmod +x build.sh`
2. Run: `./build.sh`

All methods will create a packaged XPI file in the `dist/` directory.

## License

This extension is released under the GNU General Public License, version 3.0.

## Author

alta88