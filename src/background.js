"use strict";

/* globals browser */

// In Manifest V3, we need to register listeners at the top level
// since the background page may be terminated when idle

// Listener for storage.local changes to notify chrome observer.
const storageChanged = async (changes, area) => {
  if (area != "local") {
    return;
  }
  for (let [key, value] of Object.entries(changes)) {
    // console.debug(key);
    // console.debug(value);
    if (
      "oldValue" in value &&
      !("newValue" in value && value.newValue === value.oldValue)
    ) {
      // console.debug("background.js: got a change, key - " + key);
      let storageLocalData = {};
      storageLocalData[key] = value;
      browser.morelayouts.notifyStorageLocalChanged(storageLocalData);
    }
  }
};

// Add storage change listener.
browser.storage.onChanged.addListener(storageChanged);

// Inject the main script, sync.
browser.morelayouts.injectScriptIntoChromeDocument(
  "content/morelayouts.js",
  "mail:3pane",
  false
);

console.info(
  browser.i18n.getMessage("extensionName") +
    " " +
    browser.runtime.getManifest().version
);