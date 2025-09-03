"use strict";

/* globals browser */

var MoreLayoutsOptions = {
  DEBUG: false,
  // These are also found in morelayouts.js.
  kFullscreenPaneConfigDefault: -1,
  kToggleNormalMin: 0,
  kNoTabSessionRestorePrefDefault: false,
  kVerticalTabsModePrefDefault: false,
  kToolbarModeIconsText: 0,
  kAttachmentListLocationMessageDefault: "bottom",
  kAttachmentListAlwaysShowDefault: false,
  kAttachmentListLocationComposeDefault: "bottom",

  get isAttachmentListLocationMessageTopOrBottom() {
    return ["top", "bottom"].includes(this.attachmentListLocationMessage.value);
  },

  async onLoad() {
    this.DEBUG && console.debug("MoreLayoutsOptions.onLoad:");
    this.initializeStrings();

    /* eslint-disable */
    this.fullScreenLayout = document.getElementById("fullScreenLayout");
    this.messagePaneToggleMode = document.getElementById("messagePaneToggleMode");
    this.autoHideSingleTabToolbar = document.getElementById("autoHideSingleTabToolbar");
    this.noTabSessionRestore = document.getElementById("noTabSessionRestore");
    this.verticalTabsMode = document.getElementById("verticalTabsMode");
    this.attachmentListLocationMessage = document.getElementById("attachmentListLocationMessage");
    this.attachmentListAlwaysShowOpenMessageFieldset = document.getElementById("attachmentListAlwaysShowOpenMessageFieldset");
    this.attachmentListAlwaysShowOpenMessage = document.getElementById("attachmentListAlwaysShowOpenMessage");
    this.attachmentListAlwaysShow = document.getElementById("attachmentListAlwaysShow");
    this.attachmentListLocationCompose = document.getElementById("attachmentListLocationCompose");
    this.attachmentListAlwaysShowOpenComposeFieldset = document.getElementById("attachmentListAlwaysShowOpenComposeFieldset");
    this.attachmentListAlwaysShowOpenCompose = document.getElementById("attachmentListAlwaysShowOpenCompose");
    this.restoreDefaults = document.getElementById("restoreDefaults");

    await this.restoreOptions();
    document.getElementById("container").removeAttribute("hidden");

    this.fullScreenLayout.addEventListener("change", e => this.saveOptions(e));
    this.messagePaneToggleMode.addEventListener("change", e => this.saveOptions(e));
    this.autoHideSingleTabToolbar.addEventListener("change", e => this.saveOptions(e));
    this.noTabSessionRestore.addEventListener("change", e => this.saveOptions(e));
    this.verticalTabsMode.addEventListener("change", e => this.saveOptions(e));
    this.attachmentListLocationMessage.addEventListener("change", e => this.saveOptions(e));
    this.attachmentListAlwaysShowOpenMessage.addEventListener("change", e => this.saveOptions(e));
    this.attachmentListAlwaysShow.addEventListener("change", e => this.saveOptions(e));
    this.attachmentListLocationCompose.addEventListener("change", e => this.saveOptions(e));
    this.attachmentListAlwaysShowOpenCompose.addEventListener("change", e => this.saveOptions(e));
    this.restoreDefaults.addEventListener("click", e => this.defaultOptions(e));
    /* eslint-enable */
  },

  initializeStrings() {
    document.querySelectorAll("[data-localekey]").forEach(element => {
      let message = browser.i18n.getMessage(element.dataset.localekey);
      let localeAttribute = element.dataset.localeattribute;
      if (localeAttribute) {
        element.setAttribute(localeAttribute, message);
      } else {
        element.textContent = message;
      }
    });
  },

  saveOptions(event) {
    let changeElement = event.target;
    let storageLocalData;
    switch (changeElement.id) {
      case "fullScreenLayout":
        storageLocalData = {
          fullScreenLayout: Number(this.fullScreenLayout.value),
        };
        break;
      case "messagePaneToggleMode":
        storageLocalData = {
          messagePaneToggleMode: Number(this.messagePaneToggleMode.value),
        };
        break;
      case "autoHideSingleTabToolbar":
        storageLocalData = {
          autoHideSingleTabToolbar: this.autoHideSingleTabToolbar.checked,
        };
        break;
      case "noTabSessionRestore":
        storageLocalData = {
          noTabSessionRestore: this.noTabSessionRestore.checked,
        };
        break;
      case "verticalTabsMode":
        storageLocalData = {
          verticalTabsMode: this.verticalTabsMode.checked,
        };
        break;
      case "attachmentListLocationMessage":
        storageLocalData = {
          // eslint-disable-next-line prettier/prettier
          attachmentListLocationMessage: this.attachmentListLocationMessage.value,
        };

        this.attachmentListAlwaysShowOpenMessageFieldset.disabled = !this
          .isAttachmentListLocationMessageTopOrBottom;
        this.attachmentListAlwaysShowOpenMessage.checked = !this
          .isAttachmentListLocationMessageTopOrBottom
          ? true
          : this.gAttachmentListAlwaysShowOpenMessage;
        break;
      case "attachmentListAlwaysShowOpenMessage":
        storageLocalData = {
          // eslint-disable-next-line prettier/prettier
          attachmentListAlwaysShowOpenMessage: this.attachmentListAlwaysShowOpenMessage.checked,
        };
        this.gAttachmentListAlwaysShowOpenMessage = this.attachmentListAlwaysShowOpenMessage.checked;
        break;

      case "attachmentListAlwaysShow":
        storageLocalData = {
          attachmentListAlwaysShow: this.attachmentListAlwaysShow.checked,
        };
        break;
      case "attachmentListLocationCompose":
        storageLocalData = {
          // eslint-disable-next-line prettier/prettier
          attachmentListLocationCompose: this.attachmentListLocationCompose.value,
        };
        let isDefault =
          this.attachmentListLocationCompose.value ==
          this.kAttachmentListLocationComposeDefault;

        this.attachmentListAlwaysShowOpenComposeFieldset.disabled = !isDefault;
        this.attachmentListAlwaysShowOpenCompose.checked = !isDefault
          ? true
          : this.gAttachmentListAlwaysShowOpenCompose;
        break;
      case "attachmentListAlwaysShowOpenCompose":
        storageLocalData = {
          // eslint-disable-next-line prettier/prettier
          attachmentListAlwaysShowOpenCompose: this.attachmentListAlwaysShowOpenCompose.checked,
        };
        this.gAttachmentListAlwaysShowOpenCompose = this.attachmentListAlwaysShowOpenCompose.checked;
        break;
      default:
        return;
    }

    this.setStorageLocal(storageLocalData);
  },

  async setStorageLocal(storageLocalData) {
    if (storageLocalData) {
      await browser.storage.local.set(storageLocalData);
    }

    this.DEBUG &&
      console.debug("MoreLayoutsOptions.setStorageLocal: storageLocalData ->");
    this.DEBUG && console.debug(storageLocalData);
  },

  async restoreOptions() {
    let setCurrentChoice = result => {
      this.fullScreenLayout.value =
        result?.fullScreenLayout ?? this.kFullscreenPaneConfigDefault;
      this.messagePaneToggleMode.value =
        result?.messagePaneToggleMode ?? this.kToggleNormalMin;

      this.autoHideSingleTabToolbar.checked =
        result?.autoHideSingleTabToolbar ?? false;
      this.noTabSessionRestore.checked =
        result?.noTabSessionRestore ?? this.kNoTabSessionRestorePrefDefault;
      this.verticalTabsMode.checked =
        result?.verticalTabsMode ?? this.kVerticalTabsModePrefDefault;

      this.attachmentListLocationMessage.value =
        result?.attachmentListLocationMessage ??
        this.kAttachmentListLocationMessageDefault;
      this.attachmentListAlwaysShowOpenMessageFieldset.disabled = !this
        .isAttachmentListLocationMessageTopOrBottom;
      this.gAttachmentListAlwaysShowOpenMessage =
        result?.attachmentListAlwaysShowOpenMessage;
      this.attachmentListAlwaysShowOpenMessage.checked = !this
        .isAttachmentListLocationMessageTopOrBottom
        ? true
        : this.gAttachmentListAlwaysShowOpenMessage;

      this.attachmentListAlwaysShow.checked =
        result?.attachmentListAlwaysShow ??
        this.kAttachmentListAlwaysShowDefault;
      this.attachmentListLocationCompose.value =
        result?.attachmentListLocationCompose ??
        this.kAttachmentListLocationComposeDefault;
      this.attachmentListAlwaysShowOpenComposeFieldset.disabled =
        this.attachmentListLocationCompose.value !=
        this.kAttachmentListLocationComposeDefault;
      this.gAttachmentListAlwaysShowOpenCompose =
        result?.attachmentListAlwaysShowOpenCompose;
      this.attachmentListAlwaysShowOpenCompose.checked =
        this.attachmentListLocationCompose.value !=
        this.kAttachmentListLocationComposeDefault
          ? true
          : this.gAttachmentListAlwaysShowOpenCompose;

      this.DEBUG &&
        console.debug("MoreLayoutsOptions.restoreOptions: result ->");
      this.DEBUG && console.debug(result);
    };

    let onError = error => {
      console.error(`MoreLayoutsOptions.restoreOptions: ${error}`);
    };

    let getting = browser.storage.local.get([
      "fullScreenLayout",
      "messagePaneToggleMode",
      "autoHideSingleTabToolbar",
      "noTabSessionRestore",
      "verticalTabsMode",
      "attachmentListLocationMessage",
      "attachmentListAlwaysShowOpenMessage",
      "attachmentListAlwaysShow",
      "attachmentListLocationCompose",
      "attachmentListAlwaysShowOpenCompose",
    ]);
    await getting.then(setCurrentChoice, onError);
  },

  async defaultOptions() {
    await browser.storage.local.clear();
    await this.restoreOptions();
  },
}; // MoreLayoutsOptions

(async function() {
  if (!["interactive", "complete"].includes(document.readyState)) {
    await new Promise(resolve =>
      document.addEventListener("DOMContentLoaded", resolve, { once: true })
    );
  }

  MoreLayoutsOptions.onLoad();
})();
