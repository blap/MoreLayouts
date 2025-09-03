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
│   ├── content/
│   │   ├── main.js
│   │   └── styles.css
│   ├── icons/
│   ├── options/
│   │   ├── options.html
│   │   ├── options.js
│   │   └── options.css
│   └── utils/
├── docs/
├── tests/
├── README.md
├── LICENSE
└── CHANGELOG.md
```

### Building

To build the extension, zip the contents of the src directory and rename the file extension to .xpi.

## License

This extension is released under the GNU General Public License, version 3.0.

## Author

alta88