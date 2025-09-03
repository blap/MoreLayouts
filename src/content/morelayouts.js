"use strict";

ChromeUtils.import("resource://gre/modules/Services.jsm");

/* globals ExtensionParent, FolderDisplayListenerManager, FolderPaneController,
           gBuildAttachmentsForCurrentMsg, gFolderDisplay, gFolderTreeView,
           gMessageDisplay, gMessageListeners, gMessageNotificationBar,
           gSummaryFrameManager, getBrowser, GetMessagePaneWrapper, GetNumSelectedMessages,
           GetThreadAndMessagePaneSplitter, GetThreadTree,
           getWindowStateForSessionPersistence, IsMessagePaneCollapsed,
           messenger, MsgToggleMessagePane, MozXULElement, msgWindow,
           SetFocusThreadPaneIfNotOnMessagePane,
           toggleAttachmentList, UpdateMailPaneConfig */

var MoreLayouts = {
  DEBUG: false,
  TRACE: false,

  e(element, doc) {
    return doc ? doc.getElementById(element) : document.getElementById(element);
  },

  get addonName() {
    return "MoreLayouts";
  },

  get addonId() {
    return "morelayoutsforthunderbird@mozdev.org";
  },
  get extensionInfo() {
    return ExtensionParent.GlobalManager.getExtension(this.addonId);
  },

  getBaseURL(relPath) {
    return this.extensionInfo.baseURL + relPath;
  },

  getWXAPI(extension, name, sync = false) {
    function implementation(api) {
      let impl = api.getAPI({ extension })[name];

      if (name == "storage") {
        impl.local.get = (...args) =>
          impl.local.callMethodInParentProcess("get", args);
        impl.local.set = (...args) =>
          impl.local.callMethodInParentProcess("set", args);
        impl.local.remove = (...args) =>
          impl.local.callMethodInParentProcess("remove", args);
        impl.local.clear = (...args) =>
          impl.local.callMethodInParentProcess("clear", args);
      }
      return impl;
    }

    if (sync) {
      let api = extension.apiManager.getAPI(name, extension, "addon_parent");
      return implementation(api);
    }
    return extension.apiManager
      .asyncGetAPI(name, extension, "addon_parent")
      .then(api => {
        return implementation(api);
      });
  },

  get obsTopicStorageLocalChanged() {
    return `extension:${this.addonId}:storage-local-changed`;
  },

  /*
   * Strings.
   */
  getLocaleMessage(key, substitutions) {
    if (!this.i18n) {
      this.i18n = this.getWXAPI(this.extensionInfo, "i18n", true);
      // Init some strings.
      this.extensionBye = this.i18n.getMessage("extensionBye");
    }

    return this.i18n.getMessage(key, substitutions);
  },
  },

  /*
   * Preferences.
   *
   * Initialize a map from storage.local for sync pref retrieval.
   */
  async InitializeStorageLocalMap() {
    if (this.storageLocalMap) {
      return;
    }
    this.DEBUG && console.debug("InitializeStorageLocalMap: START");
    this.storageLocalMap = new Map();
    const setCurrentPrefs = result => {
      this.DEBUG && console.debug("InitializeStorageLocalMap: result ->");
      this.DEBUG && console.debug(result);
      for (let prefKey of Object.keys(result)) {
        let storageLocalData = {};
        storageLocalData[prefKey] = { newValue: result[prefKey] };
        this.onStorageLocalChanged(storageLocalData, true);
      }

      // Prefs to init on startup.
      this.autoHideSingleTabToolbarPref;
      this.attachmentListAlwaysShowOpenMessagePref;
      this.attachmentListAlwaysShowOpenComposePref;

      this.DEBUG && console.debug("InitializeStorageLocalMap: DONE");
    };
    let onError = error => {
      console.error("MoreLayouts.InitializeStorageLocalMap: error ->");
      console.error(error);
      delete this.storageLocalMap;
    };

    this.storage = this.getWXAPI(this.extensionInfo, "storage", true);
    this.DEBUG && console.debug(this.storage.local);
    let getting = this.storage.local.get([
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
    await getting.then(setCurrentPrefs, onError);
  },

  /*
   * The notification in background.js will only send a true pref change in the
   * storage local database.
   *
   * @param {Object} storageLocalData - The key-value pair that changed; the
   *                                    value contains an |oldValue| property
   *                                    and perhaps a |newValue| property.
   */
  onStorageLocalChanged(storageLocalData) {
    this.DEBUG && console.debug("onStorageLocalChanged:storageLocalData ->");
    this.DEBUG && console.debug(storageLocalData);
    let key = Object.keys(storageLocalData)[0];
    let values = Object.values(storageLocalData)[0];
    if ("newValue" in values) {
      this.storageLocalMap.set(key, values.newValue);
    } else {
      this.storageLocalMap.delete(key);
    }

    switch (key) {
      case "autoHideSingleTabToolbar":
        this.autoHideSingleTabToolbarPref;
        break;
      case "verticalTabsMode":
        this.UpdateTabsVerticalMode();
        break;
      case "attachmentListLocationMessage":
      case "attachmentListAlwaysShowOpenMessage":
        this.UpdateAttachmentListLayout(null, null);
        break;
      case "attachmentListAlwaysShow":
      case "attachmentListLocationCompose":
      case "attachmentListAlwaysShowOpenCompose":
        this.attachmentListAlwaysShowOpenComposePref;
        for (let win of Services.wm.getEnumerator("msgcompose")) {
          this.UpdateAttachmentListLayout(null, win);
        }
        break;
      default:
        break;
    }
  },

  getStorageLocal(key) {
    return this.storageLocalMap?.get(key);
  },

  /*
   * Layout panes.
   */
  gCurrentPaneConfig: 0,

  kPaneConfigDefault: 0,
  kStandardPaneConfig: 0,
  kWidePaneConfig: 1,
  kVerticalPaneConfig: 2,
  kWideThreadPaneConfig: 3,
  kStackedPaneConfig: 4,
  kAccountCentral: 5,
  get paneConfigPref() {
    //let prefKey = "paneConfig";
    //let prefValue = this.getStorageLocal(prefKey);
    let prefValue = Services.prefs.getIntPref("mail.pane_config.dynamic");
    let defaultValue = this.kPaneConfigDefault;
    let valid = Object.keys(this.paneConfigMap).includes(String(prefValue));
    if (!valid) {
      return defaultValue;
    }

    return prefValue;
  },

  set paneConfigPref(val) {
    Services.prefs.setIntPref("mail.pane_config.dynamic", val);
  },

  // Map of state info for 3pane layouts.
  paneConfigMap: {
    0: {
      viewName: "standard",
      messagepaneParentId: "messagesBox",
      threadpaneParentId: "messagesBox",
      threadpanesplitterParentId: "messagesBox",
      threadpanesplitterOrient: "vertical",
      accountcentralReset: false,
      messagepaneboxwrapperFlex: 2,
      threadpaneParentFlex: 1, // #displayBox
      reverseboxId: "messagesBox",
    },
    1: {
      viewName: "widemessage",
      messagepaneParentId: "mailContent",
      threadpaneParentId: "messagesBox",
      threadpanesplitterParentId: "mailContent",
      threadpanesplitterOrient: "vertical",
      accountcentralReset: false,
      messagepaneboxwrapperFlex: 1,
      threadpaneParentFlex: 1,
      reverseboxId: "messengerBox",
    },
    2: {
      viewName: "vertical",
      messagepaneParentId: "threadPaneBox",
      threadpaneParentId: "messagesBox",
      threadpanesplitterParentId: "threadPaneBox",
      threadpanesplitterOrient: "horizontal",
      accountcentralReset: false,
      messagepaneboxwrapperFlex: 2,
      threadpaneParentFlex: 1,
      reverseboxId: "threadPaneBox",
    },
    3: {
      viewName: "widethread",
      messagepaneParentId: "messagesBox",
      threadpaneParentId: "mailContent",
      threadpanesplitterParentId: "mailContent",
      threadpanesplitterOrient: "vertical",
      accountcentralReset: true,
      messagepaneboxwrapperFlex: 2,
      threadpaneParentFlex: 1,
      reverseboxId: "messengerBox",
    },
    4: {
      viewName: "stacked",
      messagepaneParentId: "messagesBox",
      threadpaneParentId: "folderPaneBox",
      threadpanesplitterParentId: "folderPaneBox",
      threadpanesplitterOrient: "vertical",
      accountcentralReset: true,
      messagepaneboxwrapperFlex: 2,
      threadpaneParentFlex: 0,
      reverseboxId: "folderPaneBox",
    },
  },

  /*
   * Attachment list Message location.
   */
  kAttachmentListLocationMessageDefault: "bottom",
  get attachmentListLocationMessagePref() {
    let prefKey = "attachmentListLocationMessage";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = this.kAttachmentListLocationMessageDefault;
    let valid = Object.keys(this.attachmentListConfigMap).includes(prefValue);
    if (!valid) {
      return defaultValue;
    }

    return prefValue;
  },

  // Map of state info for each attachmentView location.
  // With header splitter, top location is now before "imip-bar" and parent. The
  // header splitter moves in InitMessageHeaderLayout() must be done before
  // InitAttachmentListLayout().
  attachmentListConfigMap: {
    top: {
      parentId: null,
      insertbeforeId: "imip-bar",
      splitterOrient: "vertical",
      splitterCollapse: "before",
    },
    right: {
      parentId: "messagepanewrapper",
      insertbeforeId: null,
      splitterOrient: "horizontal",
      splitterCollapse: "after",
    },
    bottom: {
      parentId: "singleMessage",
      insertbeforeId: null,
      splitterOrient: "vertical",
      splitterCollapse: "after",
    },
    left: {
      parentId: "messagepanewrapper",
      insertbeforeId: null,
      splitterOrient: "horizontal",
      splitterCollapse: "before",
    },
  },

  get attachmentListAlwaysShowOpenMessagePref() {
    let prefsName = "mailnews.attachments.display.start_expanded";
    let prefKey = "attachmentListAlwaysShowOpenMessage";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = Services.prefs.getBoolPref(prefsName, false);
    if (prefValue == undefined) {
      // eslint-disable-next-line prettier/prettier
      this.storage?.local.set({ attachmentListAlwaysShowOpenMessage: defaultValue });
      return defaultValue;
    }

    Services.prefs.setBoolPref(prefsName, prefValue);
    return prefValue;
  },

  /**
   * The fullscreenLayout pref can set the layout in fullscreen mode:
   * "classic"=0, "widemessage"=1, "vertical"=2, "widethread"=3, "stacked"=4
   * A value of -1 indicates no change from standard size layout.
   */
  kFullscreenLayoutDefault: -1,
  get fullscreenLayoutPref() {
    let prefKey = "fullScreenLayout";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = this.kFullscreenLayoutDefault;
    let valid = [
      this.kStandardPaneConfig,
      this.kWidePaneConfig,
      this.kVerticalPaneConfig,
      this.kWideThreadPaneConfig,
      this.kStackedPaneConfig,
      this.kFullscreenLayoutDefault,
    ].includes(prefValue);

    if (!valid) {
      return defaultValue;
    }

    return prefValue;
  },

  /**
   * For message pane F8 toggle behavior. The pref has 3 values:
   * 0: toggle normal<->min;
   * 1: toggle normal<->max;
   * 2: cycle normal->min->normal->max->normal->min..
   */
  gCurrentMessagePaneConfig: "normal",
  gPriorMessagePaneConfig: "max",
  kMessagePaneNormal: "normal",
  kMessagePaneMin: "min",
  kMessagePaneMax: "max",
  kToggleNormalMin: 0,
  kToggleNormalMax: 1,
  kToggleCycle: 2,
  get messagePaneToggleModePref() {
    let prefKey = "messagePaneToggleMode";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = this.kToggleNormalMin;
    let valid = [
      this.kToggleNormalMin,
      this.kToggleNormalMax,
      this.kToggleCycle,
    ].includes(prefValue);

    if (!valid) {
      return defaultValue;
    }

    return prefValue;
  },

  get autoHideSingleTabToolbarPref() {
    let prefsName = "mail.tabs.autoHide";
    let prefKey = "autoHideSingleTabToolbar";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = Services.prefs.getBoolPref(prefsName, false);
    if (prefValue == undefined) {
      this.storage?.local.set({ autoHideSingleTabToolbar: defaultValue });
      return defaultValue;
    }

    Services.prefs.setBoolPref(prefsName, prefValue);
    return prefValue;
  },

  kNoTabSessionRestorePrefDefault: false,
  get noTabSessionRestorePref() {
    let prefKey = "noTabSessionRestore";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = this.kNoTabSessionRestorePrefDefault;
    if (prefValue == undefined) {
      return defaultValue;
    }

    return prefValue;
  },

  kVerticalTabsModePrefDefault: false,
  get verticalTabsModePref() {
    let prefKey = "verticalTabsMode";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = this.kVerticalTabsModePrefDefault;
    if (prefValue == undefined) {
      return defaultValue;
    }

    return prefValue;
  },

  /*
   * Always show the attachment list box in Compose.
   */
  kAttachmentListAlwaysShowDefault: false,
  get attachmentListAlwaysShowPref() {
    let prefKey = "attachmentListAlwaysShow";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = this.kAttachmentListAlwaysShowDefault;
    if (prefValue == undefined) {
      return defaultValue;
    }

    return prefValue;
  },

  /*
   * Attachment list Compose location.
   */
  kAttachmentListLocationComposeDefault: "bottom",
  get attachmentListLocationComposePref() {
    let prefKey = "attachmentListLocationCompose";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = this.kAttachmentListLocationComposeDefault;
    let valid = Object.keys(this.attachmentListComposeConfigMap).includes(
      prefValue
    );
    if (!valid) {
      return defaultValue;
    }

    return prefValue;
  },

  // Map of state info for each Compose attachmentView location.
  attachmentListComposeConfigMap: {
    top: {
      parentId: "MsgHeadersToolbar",
      insertBeforeId: null,
      splitterDirection: "horizontal",
    },
    bottom: {
      parentId: "composeContentBox",
      insertBeforeId: "attachmentArea",
      splitterDirection: "vertical",
    },
  },

  get attachmentListAlwaysShowOpenComposePref() {
    let prefsName = "mail.compose.show_attachment_pane";
    let prefKey = "attachmentListAlwaysShowOpenCompose";
    let prefValue = this.getStorageLocal(prefKey);
    let defaultValue = Services.prefs.getBoolPref(prefsName, false);
    if (prefValue == undefined) {
      // eslint-disable-next-line prettier/prettier
      this.storage.local.set({ attachmentListAlwaysShowOpenCompose: defaultValue });
      return defaultValue;
    }

    Services.prefs.setBoolPref(prefsName, prefValue);
    return prefValue;
  },

  get currentTabInfo() {
    return this.tabmail?.currentTabInfo;
  },

  get isCurrentTabModeFolder() {
    return Boolean(this.currentTabInfo?.mode.type == "folder");
  },

  get isCurrentTabModeMessage() {
    return Boolean(this.currentTabInfo?.mode.type == "message");
  },
  get isCurrentTabModeGlodaList() {
    return Boolean(this.currentTabInfo?.mode.name == "glodaList");
  },

  get isAccountCentralLoaded() {
    return !(gFolderDisplay && gFolderDisplay.view.dbView);
  },

  get isFolderPaneUserCollapsed() {
    return !this.currentTabInfo.folderDisplay.folderPaneVisible;
  },

  onLoad() {
    this.DEBUG && console.debug("onLoad: START");
    if (this.checkForReload()) {
      return;
    }
    Services.obs.addObserver(this.Observer, "mail-tabs-session-restored");
    Services.obs.addObserver(this.Observer, "domwindowopened");
    Services.obs.addObserver(this.Observer, this.obsTopicStorageLocalChanged);

    // Add a listener for onEndAttachments() to gMessageListeners.
    gMessageListeners.push(this.messageListeners);

    FolderDisplayListenerManager.registerListener(this.FolderDisplayListener);
    this.tabmail?.registerTabMonitor(this.TabMonitor);

    this.mailToolbox?.addEventListener("aftercustomization", this);

    AddonManager.addAddonListener(this.AddonListener);

    this.InitializeOverrideFunctions();
    UpdateMailPaneConfig(true);

    // Initialize the prefs first.
    this.InitializeStorageLocalMap().then(() => {
      this.InitializeOverlayElements();
      this.onMailTabsSessionRestored();
    });

    this.DEBUG && console.debug("onLoad: --> MoreLayouts DONE");
  },

  checkForReload() {
    this.DEBUG && console.debug("checkForReload: START");
    if (document.getElementById("messagePaneClassicML")) {
      return true;
    }

    return false;
  },

  InitializeOverrideFunctions() {
    this.DEBUG && console.debug("InitializeOverrideFunctions: START");
    if ("UpdateMailPaneConfig" in window) {
      this._UpdateMailPaneConfig = UpdateMailPaneConfig;
      // eslint-disable-next-line no-global-assign
      UpdateMailPaneConfig = (aMsgWindowInitialized, aConfig) => {
        this.UpdateMailPaneConfig(aMsgWindowInitialized, aConfig);
      };
    }

    if ("MsgToggleMessagePane" in window) {
      this._MsgToggleMessagePane = MsgToggleMessagePane;
      // eslint-disable-next-line no-global-assign
      MsgToggleMessagePane = () => {
        this.MsgToggleMessagePane();
      };
    }

    if ("IsMessagePaneCollapsed" in window) {
      this._IsMessagePaneCollapsed = IsMessagePaneCollapsed;
      // eslint-disable-next-line no-global-assign
      IsMessagePaneCollapsed = () => {
        if (this.gCurrentMessagePaneConfig == this.kMessagePaneMax) {
          return false;
        }

        if (
          [this.kWideThreadPaneConfig, this.kStackedPaneConfig].includes(
            this.gCurrentPaneConfig
          ) &&
          !this.isCurrentTabModeGlodaList &&
          this.gCurrentMessagePaneConfig == this.kMessagePaneMin
        ) {
          return (
            this.e("folderpane_splitter").attributes.state.value == "collapsed"
          );
        }

        return (
          this.e("threadpane-splitter").attributes.state.value == "collapsed"
        );
      };
    }

    if ("getWindowStateForSessionPersistence" in window) {
      this._getWindowStateForSessionPersistence = getWindowStateForSessionPersistence;
      // eslint-disable-next-line no-global-assign
      getWindowStateForSessionPersistence = () => {
        if (this.noTabSessionRestorePref) {
          // Only restore the special firstTab, always at 0.
          let firstTab = this.tabmail.tabInfo.find(t => t.firstTab);
          this.tabmail.tabInfo = firstTab ? [firstTab] : [];
        }
        return this._getWindowStateForSessionPersistence();
      };
    }

    // Don't rerun constructor for tabmail-tabs custom element.
    // NOTE: this function isn't necessary to restore on unload.
    this.tabmailTabs._delayConnectedCallback = this.tabmailTabs.delayConnectedCallback;
    this.tabmailTabs.delayConnectedCallback = function() {
      if (this.tabmail) {
        // But we do need to add this back.
        Services.prefs.addObserver("mail.tabs.", this._prefObserver);
        return true;
      }
      return this.tabmailTabs._delayConnectedCallback();
    };
    this.DEBUG && console.debug("InitializeOverrideFunctions: DONE");
  },

  onMailTabsSessionRestored() {
    this.DEBUG && console.debug("onMailTabsSessionRestored: --> MoreLayouts");

    this.DEBUG &&
      console.debug("folderPaneVisible - " + !this.isFolderPaneUserCollapsed);

    this.UpdateTabsVerticalMode();

    if (this.isAccountCentralLoaded) {
      UpdateMailPaneConfig(true);
      gFolderDisplay?._showAccountCentral();
    }

    if (
      this.attachmentListLocationMessagePref !=
      this.kAttachmentListLocationMessageDefault
    ) {
      // Update if other than default is selected.
      this.UpdateAttachmentListLayout();
    }

    this.UpdateTabDisplay();

    this.setMutationObserver();

    // Don't need these anymore.
    delete this.i18n;
    delete this.storage;
  },

  InitializeOverlayElements() {
    this.DEBUG && console.debug("InitializeOverlayElements:");

    // Add the stylesheets.
    this.InitializeStyleSheet(
      window.document,
      "skin/morelayouts.css",
      this.addonName,
      false,
      false
    );

    // Move the notification-footer box under threadpane, only used for
    // ignore thread messages.
    this.e("threadContentArea")?.appendChild(
      this.e("messenger-notification-footer")
    );

    // Move the spacesPinnedButton to the tabs toolbar.
    this.e("tabbar-toolbar")?.appendChild(this.e("spacesPinnedButton"));

    // Make the calendar and spaces buttons customizable.
    for (let id of [
      "calendar-tab-button",
      "task-tab-button",
      "spacesPinnedButton",
    ]) {
      this.e(id)?.setAttribute("removable", true);
    }

    // Commands.
    this.e("mailCommands")?.appendChild(
      MozXULElement.parseXULToFragment(`
      <command id="View:FullScreen"
               oncommand="MoreLayouts.BrowserFullScreen();"/>
      `)
    );

    // Keys.
    this.e("mailKeys")?.appendChild(
      MozXULElement.parseXULToFragment(`
      <key id="key_fullScreen"
           keycode="VK_F11"
           command="View:FullScreen"/>
      `)
    );

    // Elements.
    this.e("mailContent")?.setAttribute("persist", "height");
    this.e("displayBox")?.setAttribute("persist", "width height");
    this.e("threadPaneBox")?.setAttribute("persist", "reverse");
    this.e("messagesBox")?.setAttribute("persist", "reverse");
    this.e("messengerBox")?.setAttribute("persist", "height reverse");
    this.e("folderPaneBox")?.setAttribute("persist", "width height reverse");

    // View->Layout menupopup and Appmenu Options|Preferences->Layout. Hide and
    // disable existing menuitems/toolbarbuttons.
    for (let id of [
      "messagePaneClassic",
      "messagePaneWide",
      "messagePaneVertical",
      "appmenu_messagePaneClassic",
      "appmenu_messagePaneWide",
      "appmenu_messagePaneVertical",
    ]) {
      let node = this.e(id);
      if (node) {
        node.hidden = true;
        node.setAttribute("disabled", true);
      }
    }

    // View - Layout - menuitems.
    let layout_container = this.e("view_layout_popup");
    layout_container?.addEventListener(
      "popupshown",
      this.InitViewLayoutStyleMenu
    );

    // Appmenu - Preferences - Layout - menuitems.
    let appmenu_layout_container = this.e("appmenu_messagePaneClassic")
      ?.parentNode;
    this.e("appMenu-popup")?.addEventListener(
      "ViewShowing",
      this.InitViewLayoutStyleMenu
    );

    // Pad out dummy menuitems to prevent false check, visible since we need to
    // use onpopupshown, since onpopupshowing function stops propagation, thus
    // we can avoid monkeypatching the function bla bla.
    layout_container?.insertBefore(
      MozXULElement.parseXULToFragment(`
      <menuitem id="layoutdummy1" extension="${this.addonId}"
                hidden="true"
                disabled="true"/>
      <menuitem id="layoutdummy2" extension="${this.addonId}"
                hidden="true"
                disabled="true"/>
      `),
      this.e("viewMenuAfterPaneVerticalSeparator")
    );

    for (let container of [layout_container, appmenu_layout_container]) {
      let idPrefix, nodeName, className, classNameReversed, insertBeforeNode;
      if (container?.id == "view_layout_popup") {
        idPrefix = "";
        nodeName = "menuitem";
        className = "";
        classNameReversed = "layout indent";
        insertBeforeNode = this.e("viewMenuAfterPaneVerticalSeparator");
      } else {
        idPrefix = "appmenu_";
        nodeName = "toolbarbutton";
        className = "subviewbutton subviewbutton-iconic";
        classNameReversed = "indent subviewbutton subviewbutton-iconic";
        insertBeforeNode = container.firstElementChild;
      }

      /* eslint-disable */
      container?.insertBefore(
        MozXULElement.parseXULToFragment(`
        <${nodeName} id="${idPrefix}messagePaneClassicML" extension="${this.addonId}"
                     class="${className}"
                     closemenu="none"
                     type="radio"
                     name="viewlayoutgroup"
                     label="${this.getLocaleMessage("layoutClassicLabel")}"
                     accesskey="${this.getLocaleMessage(
                       "layoutClassicAccesskey"
                     )}"
                     paneconfig="kStandardPaneConfig"
                     oncommand="MoreLayouts.ChangeMailLayout(event);"/>
        <${nodeName} id="${idPrefix}messagePaneWideML" extension="${this.addonId}"
                     class="${className}"
                     closemenu="none"
                     type="radio"
                     name="viewlayoutgroup"
                     label="${this.getLocaleMessage("layoutWideLabel")}"
                     accesskey="${this.getLocaleMessage("layoutWideAccesskey")}"
                     paneconfig="kWidePaneConfig"
                     oncommand="MoreLayouts.ChangeMailLayout(event);"/>
        <${nodeName} id="${idPrefix}messagePaneVerticalML" extension="${this.addonId}"
                     class="${className}"
                     closemenu="none"
                     type="radio"
                     name="viewlayoutgroup"
                     label="${this.getLocaleMessage("layoutVerticalLabel")}"
                     accesskey="${this.getLocaleMessage(
                       "layoutVerticalAccesskey"
                     )}"
                     paneconfig="kVerticalPaneConfig"
                     oncommand="MoreLayouts.ChangeMailLayout(event);"/>
        <${nodeName} id="${idPrefix}messagePaneVerticalReversedML" extension="${this.addonId}"
                     class="${classNameReversed}"
                     closemenu="none"
                     type="checkbox"
                     persist="checked"
                     label="${this.getLocaleMessage(
                       "layoutVerticalReversedLabel"
                     )}"
                     accesskey="${this.getLocaleMessage(
                       "layoutVerticalReversedAccesskey"
                     )}"
                     paneconfig="kVerticalPaneConfig"
                     reverselayout="true"
                     oncommand="MoreLayouts.reverseLayout(event);"/>
        <${nodeName} id="${idPrefix}messagePaneWideThreadML" extension="${this.addonId}"
                     class="${className}"
                     closemenu="none"
                     type="radio"
                     name="viewlayoutgroup"
                     label="${this.getLocaleMessage("layoutWideThreadLabel")}"
                     accesskey="${this.getLocaleMessage(
                       "layoutWideThreadAccesskey"
                     )}"
                     paneconfig="kWideThreadPaneConfig"
                     oncommand="MoreLayouts.ChangeMailLayout(event);"/>
        <${nodeName} id="${idPrefix}messagePaneWideThreadReversedML" extension="${this.addonId}"
                     class="${classNameReversed}"
                     closemenu="none"
                     type="checkbox"
                     persist="checked"
                     label="${this.getLocaleMessage(
                       "layoutWideThreadReversedLabel"
                     )}"
                     accesskey="${this.getLocaleMessage(
                       "layoutWideThreadReversedAccesskey"
                     )}"
                     paneconfig="kWideThreadPaneConfig"
                     reverselayout="true"
                     oncommand="MoreLayouts.reverseLayout(event);"/>
        <${nodeName} id="${idPrefix}messagePaneStackedML" extension="${this.addonId}"
                     class="${className}"
                     closemenu="none"
                     type="radio"
                     name="viewlayoutgroup"
                     label="${this.getLocaleMessage("layoutStackedLabel")}"
                     accesskey="${this.getLocaleMessage(
                       "layoutStackedAccesskey"
                     )}"
                     paneconfig="kStackedPaneConfig"
                     oncommand="MoreLayouts.ChangeMailLayout(event);"/>
        <${nodeName} id="${idPrefix}messagePaneStackedReversedML" extension="${this.addonId}"
                     class="${classNameReversed}"
                     closemenu="none"
                     type="checkbox"
                     persist="checked"
                     label="${this.getLocaleMessage(
                       "layoutStackedReversedLabel"
                     )}"
                     accesskey="${this.getLocaleMessage(
                       "layoutStackedReversedAccesskey"
                     )}"
                     paneconfig="kStackedPaneConfig"
                     reverselayout="true"
                     oncommand="MoreLayouts.reverseLayout(event);"/>
        `),
        insertBeforeNode
      );
      /* eslint-enable */

      // Add the fullscreen option.
      /* eslint-disable */
      container?.appendChild(
        MozXULElement.parseXULToFragment(`
        <${nodeName} id="${idPrefix}menu_fullScreenML" extension="${this.addonId}"
                     class="${className}"
                     type="checkbox"
                     label="${this.getLocaleMessage("fullScreenLabel")}"
                     accesskey="${this.getLocaleMessage("fullScreenAccesskey")}"
                     acceltext="F11"
                     key="key_fullScreen"
                     oncommand="MoreLayouts.BrowserFullScreen();"/>
        `)
      );
      /* eslint-enable */
    }

    this.InitMessageHeaderLayout();
    this.InitAttachmentListLayout(window);

    // "Customize" header toolbar buttons.
    this.e("header-view-toolbar")?.classList.add("toolbar");

    this.DEBUG && console.debug("InitializeOverlayElements: DONE");
  },

  /*
   * Inject a stylesheet, either chrome file or addon relative file.
   *
   * @param {Document} doc            - Document for the css injection.
   * @param {String} styleSheetSource - Resource or relative file name.
   * @param {String} styleName        - Name for DOM title.
   * @param {Boolean} isChrome        - Is this a chrome url.
   * @param {Boolean} isOS            - Is this an os specific source.
   */
  InitializeStyleSheet(doc, styleSheetSource, styleName, isChrome, isOS) {
    this.DEBUG && console.debug("InitializeStyleSheet:");
    let href;
    if (isChrome) {
      href = styleSheetSource;
    } else {
      href = this.getBaseURL(styleSheetSource);
    }

    this.DEBUG &&
      console.debug("InitializeStyleSheet: styleSheet - " + styleSheetSource);
    this.DEBUG && console.debug("InitializeStyleSheet: href - " + href);
    let os = "";
    if (isOS) {
      os += "_" + AppConstants.platform;
    }
    let link = doc.createElement("link");
    link.setAttribute("id", this.addonId + os);
    link.setAttribute("title", styleName + os);
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("type", "text/css");
    link.setAttribute("href", href);
    // The |sheet| property is now (post Tb78) added after the sheet loads.
    // We must do this when setting title else another extension using this
    // technique may have its sheet be the |document.selectedStyleSheetSet|.
    link.setAttribute("onload", "this.sheet.disabled=false");
    doc.documentElement.appendChild(link);
    this.DEBUG && console.debug(link.sheet);
  },

  Observer: {
    observe(subject, topic, data) {
      MoreLayouts.TRACE &&
        console.debug("Observer: " + topic + ", data - " + data);
      if (topic == "domwindowopened" && Window.isInstance(subject)) {
        MoreLayouts.onDomWindowOpened(subject);
      } else if (topic == MoreLayouts.obsTopicStorageLocalChanged) {
        MoreLayouts.DEBUG &&
          console.debug("Observer: " + topic + ", data - " + data);
        MoreLayouts.onStorageLocalChanged(JSON.parse(data));
      }
    },
  },

  TabMonitor: {
    monitorName: "MoreLayouts",
    onTabTitleChanged() {},
    onTabSwitched(tab, oldTab) {
      let tabInfo = tab;
      MoreLayouts.DEBUG &&
        console.debug(
          "onTabSwitched: id:type:selected:tabId:busy:title - " +
            tabInfo.browser?.id +
            ":" +
            tabInfo.mode.type +
            ":" +
            tabInfo.tabNode.selected +
            ":" +
            tabInfo.tabId +
            ":" +
            tabInfo.busy +
            ":" +
            tabInfo.title
        );
      if (
        MoreLayouts.isCurrentTabModeFolder ||
        MoreLayouts.isCurrentTabModeGlodaList
      ) {
        MoreLayouts.UpdateTabDisplay();
      } else {
        MoreLayouts.DEBUG &&
          console.debug("onTabSwitched: !tabType folder|glodaList, EXIT");
      }
    },
    onTabOpened(tab, firstTab, oldTab) {
      let tabInfo = tab;
      MoreLayouts.DEBUG &&
        console.debug(
          "onTabOpened: id:type:selected:tabId:busy:title - " +
            tabInfo.browser?.id +
            ":" +
            tabInfo.mode.type +
            ":" +
            tabInfo.tabNode.selected +
            ":" +
            tabInfo.tabId +
            ":" +
            tabInfo.busy +
            ":" +
            tabInfo.title
        );
      // Set the container property for key scrolling. Bug 1718559.
      tabInfo.tabNode.container = tabInfo.tabNode.parentElement.parentElement;
      // Cannot set var with -moz-accent-color in our css rules method.
      tabInfo.tabNode
        .querySelector(".tab-background")
        ?.setAttribute(
          "style",
          "outline-color: var(--toolbar-field-focus-border-color);"
        );
      tabInfo.tabNode.setAttribute("onclick", "this.focus();");
    },
  },

  FolderDisplayListener: {
    onMakeActive(folderDisplay) {
      MoreLayouts.DEBUG && console.debug("onMakeActive: folderDisplay ->");
      MoreLayouts.DEBUG && console.debug(folderDisplay);
      if (!MoreLayouts.isCurrentTabModeFolder) {
        MoreLayouts.DEBUG &&
          console.debug("onMakeActive: !tabType folder, EXIT");
        return;
      }
      if (!MoreLayouts.isAccountCentralLoaded) {
        MoreLayouts.DEBUG && console.debug("onMakeActive: in showThreadPane");
        let threadPaneBox = MoreLayouts.e("threadPaneBox");
        if (!threadPaneBox.collapsed) {
          // It seems makeActive() fires twice merely switching from account to
          // a folder; don't need to go into UpdateMailPaneConfig if showing
          // threadPaneBox.
          return;
        }
        MoreLayouts.DEBUG && console.debug("onMakeActive: showThreadPane");
      } else {
        MoreLayouts.DEBUG && console.debug("onMakeActive: showAccountCentral");
      }

      UpdateMailPaneConfig(true);
    },

    onActiveCreatedView(folderDisplay) {
      MoreLayouts.DEBUG && console.debug("onActiveCreatedView: START");
      if (!MoreLayouts.isCurrentTabModeFolder) {
        MoreLayouts.DEBUG &&
          console.debug("onActiveCreatedView: !tabType folder, EXIT");
        return;
      }

      MoreLayouts.UpdateTabDisplay();
    },
  },

  /**
   * Listener in gMessageListeners.
   */
  messageListeners: {
    onStartHeaders() {},
    onEndHeaders() {
      MoreLayouts.DEBUG && console.debug("onEndHeaders:  ");
      // Removed collapsed state as it prevents resizing; if really collapsed
      // the height will be 0.
      MoreLayouts.setHeaderSplitter();

      // If there is a notification later, the mutation observer will update
      // collapsed state.
      let notification = MoreLayouts.e("mail-notification-top");
      let stack = notification.querySelector(".notificationbox-stack");
      notification.collapsed = !stack || stack.childElementCount == 0;
    },
    async onEndAttachments() {
      if (currentAttachments.length < 1) {
        toggleAttachmentList(false);
        return;
      }
      MoreLayouts.DEBUG &&
        console.debug(
          "onEndAttachments: gBuildAttachmentsForCurrentMsg - " +
            gBuildAttachmentsForCurrentMsg
        );

      const sleep = ms => {
        /* eslint-disable mozilla/no-arbitrary-setTimeout */
        return new Promise(resolve => setTimeout(resolve, ms));
      };
      // Due to now async attachment resolution (file://) wait until it's done.
      while (!gBuildAttachmentsForCurrentMsg) {
        await sleep(20);
      }
      MoreLayouts.DEBUG && console.debug("onEndAttachments: built");
      MoreLayouts.e("mail-notification-top").removeAttribute("height");
      // The left/right locations are always open.
      if (
        ["left", "right"].includes(
          MoreLayouts.attachmentListLocationMessagePref
        )
      ) {
        MoreLayouts.DEBUG && console.debug("onEndAttachments: left/right");
        toggleAttachmentList(true);
      }
    },
  },

  onDomWindowOpened(window) {
    this.DEBUG && console.debug("onDomWindowOpened: START  window ->");
    this.DEBUG && console.debug(window);

    window.addEventListener("load", event => {
      let win = event.target;
      let winType = win.documentElement.getAttribute("windowtype");
      this.DEBUG &&
        console.debug("onDomWindowOpened: load winType - " + winType);

      // For attachment list location in compose window only.
      if (winType != "msgcompose") {
        return;
      }

      win.documentElement.addEventListener(
        "compose-window-init",
        () => {
          this.DEBUG && console.debug("onDomWindowOpened:compose-window-init");
          win.defaultView.gMsgCompose.RegisterStateListener(
            MoreLayouts.ComposeStateListener
          );
        },
        { once: true }
      );
    });
  },

  /*
   * Listener for compose window state.
   */
  ComposeStateListener: {
    ComposeProcessDone() {},
    SaveInFolderDone() {},
    NotifyComposeFieldsReady() {
      MoreLayouts.DEBUG && console.debug("NotifyComposeFieldsReady: START");
    },
    NotifyComposeBodyReady() {
      MoreLayouts.DEBUG && console.debug("NotifyComposeBodyReady: START");
      let composeWin = Services.wm.getMostRecentWindow("msgcompose");

      // Add the stylesheet.
      MoreLayouts.InitializeStyleSheet(
        composeWin.document,
        "skin/morelayouts-compose.css",
        MoreLayouts.addonName,
        false,
        false
      );
      // Add some OS specific style rules.
      if (AppConstants.platform == "linux") {
        let link = MoreLayouts.e(MoreLayouts.addonId, composeWin.document);
        const insertRule = event => {
          let rule =
            "#msgIdentity," +
            '[attachmentlistlocation="top"] #attachmentArea > summary {' +
            "  margin-top: 1px !important;" +
            "}";
          let sheet = event.target.sheet;
          sheet.insertRule(rule, sheet.cssRules.length);
        };
        link.addEventListener("load", insertRule);
      }

      //setTimeout(() => {
      MoreLayouts.InitAttachmentListLayout(composeWin);
      MoreLayouts.UpdateAttachmentListLayout(
        MoreLayouts.attachmentListLocationComposePref,
        composeWin
      );
      //}, 0);
    },
  },

  setMutationObserver() {
    this.DEBUG && console.debug("setMutationObserver: START ");
    let mo = new MutationObserver(mutations => this.onMutations(mutations));
    mo.observe(this.e("mail-notification-top"), {
      subtree: true,
      childList: true,
    });
    this.MutationObserver = mo;
  },

  onMutations(mutations) {
    this.DEBUG && console.debug(mutations);
    for (let mutation of mutations) {
      let target = mutation.target;
      if (!target.classList.contains("notificationbox-stack")) {
        continue;
      }
      target.parentElement.collapsed = target.childElementCount == 0;
      this.DEBUG &&
        console.debug(
          "onMutations: collapsed, mutation -> " +
            target.parentElement.collapsed
        );
      this.DEBUG && console.debug(mutation);
    }
  },

  /*
   * Listener for addon status changes.
   */
  AddonListener: {
    resetSession(addon, who) {
      if (addon.id != MoreLayouts.addonId) {
        return;
      }
      MoreLayouts.DEBUG &&
        console.debug("AddonListener.resetSession: who - " + who);
      console.info(MoreLayouts.extensionBye);

      Services.obs.notifyObservers(null, "startupcache-invalidate");
      // Folklore has it that this call is also required for a smooth upgrade
      // experience.
      Services.obs.notifyObservers(null, "chrome-flush-caches");

      Services.prompt.alert(
        window,
        MoreLayouts.getLocaleMessage("extensionName"),
        MoreLayouts.getLocaleMessage("restartMessage")
      );
      this.restart();
    },
    restart() {
      let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
        Ci.nsISupportsPRBool
      );
      Services.obs.notifyObservers(
        cancelQuit,
        "quit-application-requested",
        "restart"
      );
      // XXX: should this be allowed; state will be not right without restart.
      if (cancelQuit.data) {
        return;
      }

      let flags = Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart;
      Services.startup.quit(flags);
    },
    onUninstalling(addon) {
      this.resetSession(addon, "onUninstalling");
    },
    onInstalling(addon) {
      this.resetSession(addon, "onInstalling");

      Services.obs.notifyObservers(null, "startupcache-invalidate");
      // Folklore has it that this call is also required for a smooth upgrade
      // experience.
      Services.obs.notifyObservers(null, "chrome-flush-caches");
    },
    onDisabling(addon) {
      this.resetSession(addon, "onDisabling");
    },
    // The listener is removed so these aren't run; they aren't needed as the
    // addon is installed by the addon system and runs our backgound.js loader.
    onEnabling(addon) {
      MoreLayouts.DEBUG && console.debug("AddonListener.onEnabling");
    },
    onOperationCancelled(addon) {
      MoreLayouts.DEBUG && console.debug("AddonListener.onOperationCancelled");
    },
  },

  /**
   * Change the layout.
   *
   * @param {Event} event - Click event.
   * @returns {void}
   */
  ChangeMailLayout(event) {
    let paneconfig = event.target.getAttribute("paneconfig");
    let newLayout = this[paneconfig];
    this.paneConfigPref = newLayout;
    this.UpdateViewLayoutStyleMenu(event.target.parentNode);
  },

  /**
   * Restore the msgWindow object.
   *
   * @returns {void}
   */
  rerootMsgWindow() {
    this.DEBUG && console.debug("rerootMsgWindow: START");

    messenger.setWindow(null, null);
    messenger.setWindow(window, msgWindow);

    // And now the current dbview; re-init mMsgWindowWeak etc.
    gFolderDisplay.msgWindow = msgWindow;
    gFolderDisplay.messenger = messenger;
    gFolderDisplay.view.dbView.init(
      messenger,
      msgWindow,
      gFolderDisplay.view.listener.threadPaneCommandUpdater
    );

    // Now make sure each tab's msgWindow object is reset.
    let tabmail = this.tabmail || [];
    for (let tabInfo of tabmail.tabInfo) {
      if (tabInfo.mode.type == "folder" || tabInfo.mode.name == "glodaList") {
        tabInfo.folderDisplay.messenger.setWindow(window, msgWindow);
      }
      if (tabInfo.mode.type == "message" || tabInfo.mode.name == "glodaList") {
        tabInfo.messageDisplay.folderDisplay.messenger.setWindow(
          window,
          msgWindow
        );
      }
    }

    this.DEBUG && console.debug("rerootMsgWindow: DONE");
  },

  /**
   * Restore threadpane references and view.
   *
   * @returns {void}
   */
  rerootThreadPane() {
    this.DEBUG && console.debug("rerootThreadPane: START");

    let tabmail = this.tabmail || [];
    let threadTree = GetThreadTree();
    let treeView = gFolderDisplay?.view?.dbView;

    if (!treeView) {
      return;
    }

    for (let tabInfo of tabmail.tabInfo) {
      if (tabInfo.mode.type == "folder" || tabInfo.mode.name == "glodaList") {
        tabInfo.folderDisplay.tree = threadTree;
        this.DEBUG &&
          console.debug(
            "rerootThreadPane: tab type:title - " +
              tabInfo.mode.type +
              ":" +
              tabInfo.title
          );
      }
    }

    threadTree.view = treeView;
    this.DEBUG && console.debug("rerootThreadPane: treeView done");

    this.DEBUG && console.debug("rerootThreadPane: DONE");
  },

  /*****************************************************************************
   * Vertical tabs toolbar handling.
   ****************************************************************************/
  get titlebar() {
    return this.e("titlebar");
  },
  get mailToolbox() {
    return this.e("mail-toolbox");
  },
  get tabmailContainer() {
    return this.e("tabmail-container");
  },
  get tabsToolbar() {
    return this.e("tabs-toolbar");
  },
  get tabmailTabs() {
    return this.e("tabmail-tabs");
  },
  get tabmail() {
    return this.e("tabmail");
  },
  get tabmailArrowscrollbox() {
    return this.e("tabmail-arrowscrollbox");
  },
  get tabbarToolbar() {
    return this.e("tabbar-toolbar");
  },
  get notificationPopupBox() {
    return this.e("notification-popup-box");
  },
  get tabDropIndicator_Default() {
    return this.tabmailTabs.querySelector(".tab-drop-indicator");
  },
  get tabDropIndicator_Vertical() {
    return this.verticalTabsContainer?.querySelector(".tab-drop-indicator");
  },
  get titlebarButtonboxContainer() {
    return this.tabsToolbar.querySelector(".titlebar-buttonbox-container");
  },
  get alltabsButton() {
    return this.e("alltabs-button");
  },
  get verticalTabsContainer() {
    return this.e("vertical-tabs-container");
  },
  get verticalTabsToolbox() {
    return this.e("vertical-tabs-toolbox");
  },
  get verticalTabsSplitter() {
    return this.e("vertical-tabs-splitter");
  },

  /*
   * Event handler for |this|.
   */
  handleEvent(event) {
    switch (event.type) {
      case "aftercustomization":
        this.resetAlltabsButtonMenupopup();
        break;
    }
  },

  /*
   * Reset alltabs button on tabs mode change and toolbar Customize.
   * Bug 1554627 failed to correctly detect if the connectedCallback() has run.
   */
  resetAlltabsButtonMenupopup() {
    this.DEBUG && console.debug("resetAlltabsButtonMenupopup:");
    this.alltabsButton?.menupopup.remove();
    this.alltabsButton?.prepend(
      MozXULElement.parseXULToFragment(`
        <menupopup is="tabmail-alltabs-menupopup" id="alltabs-popup"
                   position="after_end"
                   tabcontainer="tabmail-tabs"/>
      `)
    );
  },

  /*
   * Set horizontal or vertical tabs mode.
   *
   * @param {Boolean} restoreTabs - If true, restore horizontal tabs.
   */
  UpdateTabsVerticalMode(restoreTabs) {
    let tabsToolbar = this.tabsToolbar;
    if (!tabsToolbar || !this.tabmailContainer) {
      return;
    }

    const setTabsOrient = orient => {
      for (let id of [
        "tabs-toolbar",
        "tabmail-tabs",
        "tabmail-arrowscrollbox",
      ]) {
        this.e(id)?.setAttribute("orient", orient);
      }
    };

    const onDragOver = event => {
      let dt = event.dataTransfer;

      this.DEBUG && console.debug("onDragOver: event.dataTransfer ->");
      this.DEBUG && console.debug(dt);
      if (
        dt.mozItemCount == 0 ||
        dt.mozGetDataAt("text/toolbarwrapper-id/messengerWindow", 0) != null ||
        (dt.mozTypesAt(0)[0] != "application/x-moz-tabmail-tab" &&
          dt.mozTypesAt(0)[1] != "application/x-moz-tabmail-json")
      ) {
        // Let horizontal tabs handle it.
        return;
      }

      let rect = this.tabmailTabs.getBoundingClientRect();

      let [index, tabHeight] = _getDropIndexVertical(event);
      this.DEBUG &&
        console.debug(
          // eslint-disable-next-line prettier/prettier
          "onDragOver: top:index:tabHeight - " + top + ":" + index + ":" + tabHeight
        );

      let ind = this.tabmailTabs._tabDropIndicator;
      ind.style.top = rect.top + index * tabHeight + "px";
    };

    const onDrop = event => {
      let dt = event.dataTransfer;

      this.DEBUG && console.debug("onDrop: event.dataTransfer, rect ->");
      this.DEBUG && console.debug(dt);
      if (
        dt.mozItemCount != 1 ||
        dt.mozGetDataAt("text/toolbarwrapper-id/messengerWindow", 0) != null ||
        (dt.mozTypesAt(0)[0] != "application/x-moz-tabmail-tab" &&
          dt.mozTypesAt(0)[1] != "application/x-moz-tabmail-json")
      ) {
        // Let horizontal tabs handle it.
        return;
      }

      let draggedTab = dt.mozGetDataAt("application/x-moz-tabmail-tab", 0);
      if (!draggedTab) {
        return;
      }

      event.stopPropagation();
      this.tabmailTabs._tabDropIndicator.hidden = true;

      // Is the tab one of our children?
      if (this.tabmailTabs.getIndexOfItem(draggedTab) == -1) {
        // It's a tab from an other window, so we have to trigger session
        // restore to get our tab

        let tabmail2 = draggedTab.ownerDocument.getElementById("tabmail");
        if (!tabmail2) {
          return;
        }

        let draggedJson = dt.mozGetDataAt("application/x-moz-tabmail-json", 0);
        if (!draggedJson) {
          return;
        }

        draggedJson = JSON.parse(draggedJson);

        // Some tab exist only once, so we have to gamble a bit. We close
        // the tab and try to reopen it. If something fails the tab is gone.

        tabmail2.closeTab(draggedTab, true);

        if (!this.tabmail.restoreTab(draggedJson)) {
          return;
        }

        draggedTab = this.tabmailTabs.allTabs[
          this.tabmailTabs.allTabs.length - 1
        ];
      }

      let [idx] = _getDropIndexVertical(event);

      // Fix the DropIndex in case it points to tab that can't be closed
      let tabInfo = this.tabmail.tabInfo;
      while (idx < tabInfo.length && !tabInfo[idx].canClose) {
        idx++;
      }

      this.DEBUG &&
        console.debug(
          "onDrop: drop index, tabTitle - " + idx + ":" + draggedTab.textContent
        );

      this.tabmail.moveTabTo(draggedTab, idx);

      this.tabmail.switchToTab(draggedTab);
      this.tabmail.updateCurrentTab();
    };

    const _getDropIndexVertical = event => {
      let tabs = this.tabmailTabs.allTabs;
      let height;

      for (let i = 0; i < tabs.length; i++) {
        height = tabs[i].getBoundingClientRect().height;
        if (event.screenY < tabs[i].screenY + height / 2) {
          // Can't drop before firstTab at 0.
          return [i || 1, height];
        }
      }

      return [tabs.length, height];
    };

    this.DEBUG &&
      console.debug(
        "UpdateTabsVerticalMode: START, verticalTabsModePref:restoreTabs - " +
          this.verticalTabsModePref +
          ":" +
          restoreTabs +
          ":" +
          tabsToolbar.parentNode.id +
          ":" +
          this.titlebar?.id
      );

    if (!this.verticalTabsModePref || restoreTabs) {
      if (tabsToolbar.parentNode.id == this.titlebar?.id) {
        // If vertical mode is not on, return.
        return;
      }

      // Restore the tabs.

      tabsToolbar.insertBefore(this.notificationPopupBox, this.tabmailTabs);
      this.titlebar?.appendChild(tabsToolbar);
      let insertBeforeNode = tabsToolbar.lastElementChild;
      tabsToolbar.insertBefore(this.tabbarToolbar, insertBeforeNode);
      tabsToolbar.insertBefore(this.alltabsButton, insertBeforeNode);
      // eslint-disable-next-line prettier/prettier
      tabsToolbar.insertBefore(this.titlebarButtonboxContainer, insertBeforeNode);
      this.resetAlltabsButtonMenupopup();
      setTabsOrient("horizontal");
      this.tabmailArrowscrollbox._startEndProps = null;
      this.tabmailTabs.setAttribute("align", "end");
      this.tabmailTabs.setAttribute("collapsetoolbar", "tabs-toolbar");
      this.tabmailTabs.mCollapseToolbar = tabsToolbar;
      this.tabmailTabs.prepend(this.tabDropIndicator_Vertical);
      // eslint-disable-next-line prettier/prettier
      this.tabmailTabs.removeEventListener("dragover", onDragOver, { capture: true });
      this.tabmailTabs.removeEventListener("drop", onDrop, { capture: true });
      this.verticalTabsSplitter.remove();
      this.verticalTabsContainer.remove();

      document.documentElement.toggleAttribute("verticaltabs", false);
      this.DEBUG && console.debug("UpdateTabsVerticalMode: RESET");
      return;
    }

    if (tabsToolbar.parentNode.id == this.verticalTabsToolbox?.id) {
      // If vertical mode is already on, return.
      return;
    }

    this.tabmailContainer?.prepend(
      MozXULElement.parseXULToFragment(`
        <splitter id="vertical-tabs-splitter" Xextension="${this.addonId}"
                  collapse="before"/>
      `)
    );

    let width =
      Services.xulStore.getValue(
        document.URL,
        "vertical-tabs-container",
        "width"
      ) || 300;
    this.tabmailContainer?.prepend(
      MozXULElement.parseXULToFragment(`
        <hbox id="vertical-tabs-container" Xextension="${this.addonId}"
              Xcollapsed="true"
              width="${width}"
              persist="width">
          <vbox id="vertical-tabs-toolbox"
                class="mail-toolbox"
                flex="1"/>
        </hbox>
      `)
    );

    this.tabmailTabs.removeAttribute("align");
    this.tabmailTabs.setAttribute("collapsetoolbar", "vertical-tabs-container");
    this.tabmailTabs.mCollapseToolbar = this.verticalTabsContainer;
    this.tabmailTabs._mAutoHide = false;
    // eslint-disable-next-line prettier/prettier
    this.tabmailTabs.addEventListener("dragover", onDragOver, { capture: true });
    this.tabmailTabs.addEventListener("drop", onDrop, { capture: true });

    this.tabmailArrowscrollbox._startEndProps = null;
    this.tabmailArrowscrollbox.removeAttribute("overflowing");
    tabsToolbar.prepend(this.notificationPopupBox);
    tabsToolbar.collapsed = false;
    this.verticalTabsToolbox.append(tabsToolbar);
    setTabsOrient("vertical");

    this.verticalTabsContainer.prepend(this.tabDropIndicator_Default);
    this.verticalTabsToolbox.append(this.tabbarToolbar);
    this.tabbarToolbar.setAttribute("orient", "horizontal");
    this.tabbarToolbar.append(this.alltabsButton);
    this.resetAlltabsButtonMenupopup();

    document.documentElement.toggleAttribute("verticaltabs", true);
    this.tabmailTabs.mAutoHide = this.autoHideSingleTabToolbarPref;
    this.DEBUG && console.debug("UpdateTabsVerticalMode: DONE");
  }, // End Vertical tabs toolbar handling.

  /**
   * When switching tabs and showing threadpane, make sure all views are
   * correct, given we may be in a message pane toggle state. Each folder tab
   * may have its own state.
   *
   * @returns {void}
   */
  UpdateTabDisplay() {
    this.DEBUG && console.debug("UpdateTabDisplay: currentTabInfo ->");
    this.DEBUG && console.debug(this.currentTabInfo);
    if (!this.currentTabInfo) {
      return;
    }

    let tabMode = this.currentTabInfo.mode;
    this.DEBUG &&
      console.debug(
        "UpdateTabDisplay: tabMode type:name - " +
          tabMode.type +
          ":" +
          tabMode.name
      );

    this.e("mailContent").setAttribute("tabmodetype", tabMode.type);

    if (this.isCurrentTabModeFolder) {
      let folderDisplay = this.currentTabInfo.folderDisplay;
      if ("messagePaneState" in folderDisplay) {
        this.gCurrentMessagePaneConfig = folderDisplay.messagePaneState;
      } else {
        this.gCurrentMessagePaneConfig = this.kMessagePaneNormal;
      }

      this.MessagePaneMaxShowHide(this.gCurrentMessagePaneConfig);
    } else if (
      this.isCurrentTabModeGlodaList &&
      this.gCurrentPaneConfig == this.kStackedPaneConfig
    ) {
      // Ensure threadpane is visible in glodaList stacked view.
      this.updateStackedGlodaList();
    }
  },

  /**
   * Set enable/disable status of View->Layout and AppMenu->..->Layout
   * menuitems. Runs onpopupshown() or panel load, respectively.
   *
   * @param {Event} event - Event.
   *
   * @returns {void}
   */
  InitViewLayoutStyleMenu(event) {
    this.DEBUG &&
      console.debug("InitViewLayoutStyleMenu: target.id - " + event.target.id);
    if (
      !["view_layout_popup", "appMenu-preferencesLayoutView"].includes(
        event.target.id
      )
    ) {
      return;
    }

    // Prevent triggering popupshown/ViewShowing by other listeners, if any,
    // via bubbling of events.
    event.stopImmediatePropagation();

    let parent =
      event.target.id == "appMenu-preferencesLayoutView"
        ? event.target.querySelector(".panel-subview-body")
        : event.target;

    MoreLayouts.UpdateViewLayoutStyleMenu(parent);
  },

  /**
   * Update enable/disable status of View->Layout and AppMenu->..->Layout
   * menuitems.
   *
   * @param {Element} parent - Parent element of layout menuitems/buttons.
   *
   * @returns {void}
   */
  UpdateViewLayoutStyleMenu(parent) {
    this.DEBUG && console.debug("UpdateViewLayoutStyleMenu: START");
    let layoutStyleMenuitems = parent.querySelectorAll(
      "[name='viewlayoutgroup']"
    );
    let enable =
      this.isCurrentTabModeFolder &&
      !this.isAccountCentralLoaded &&
      this.gCurrentMessagePaneConfig == this.kMessagePaneNormal;

    for (let item of layoutStyleMenuitems) {
      if (item.hidden) {
        continue;
      }
      let paneconfig = item.getAttribute("paneconfig");
      if (paneconfig && this[paneconfig] == this.paneConfigPref) {
        item.setAttribute("checked", "true");
      } else {
        item.removeAttribute("checked");
      }
      this.TRACE &&
        console.debug(
          "UpdateViewLayoutStyleMenu: itemId:enable:checked - " +
            item.id +
            ":" +
            enable +
            ":" +
            (item.getAttribute("checked") || "false")
        );

      if (enable) {
        item.removeAttribute("disabled");
      } else {
        item.setAttribute("disabled", true);
      }
    }

    this.InitViewLayoutReverseMenu(parent);
  },

  /**
   * Set enable/disable status of View->Layout and AppMenu->..->Layout
   * reverse menuitems.
   *
   * @param {Element} parent - Parent element of layout menuitems/buttons.
   *
   * @returns {void}
   */
  InitViewLayoutReverseMenu(parent) {
    this.DEBUG && console.debug("InitViewLayoutReverseMenu: START");
    let layoutStyleMenuitems = parent.querySelectorAll("[reverselayout]");
    let enable =
      this.isCurrentTabModeFolder &&
      !this.isAccountCentralLoaded &&
      this.gCurrentMessagePaneConfig == this.kMessagePaneNormal;

    for (let item of layoutStyleMenuitems) {
      let paneconfig = this[item.getAttribute("paneconfig")];
      let disable = paneconfig != this.gCurrentPaneConfig;
      let desiredReverseBoxId = this.paneConfigMap[paneconfig].reverseboxId;
      let checked = this.e(desiredReverseBoxId).hasAttribute("reverse");
      this.TRACE &&
        console.debug(
          "InitViewLayoutReverseMenu: itemId:enable:disable:checked - " +
            item.id +
            ":" +
            enable +
            ":" +
            disable +
            ":" +
            checked
        );

      if (enable && !disable) {
        item.removeAttribute("disabled");
      } else {
        item.setAttribute("disabled", true);
      }

      if (checked) {
        item.setAttribute("checked", true);
      } else {
        item.removeAttribute("checked");
      }
    }
  },

  /**
   * Replace UpdateMailPaneConfig().
   *
   * @param {Boolean} aMsgWindowInitialized - True if initialized.
   * @param {Number} aConfig                - Integer for pane config.
   *
   * @returns {void}
   */
  /* eslint-disable complexity */
  UpdateMailPaneConfig(aMsgWindowInitialized, aConfig) {
    this.DEBUG &&
      console.debug(
        "UpdateMailPaneConfig: aMsgWindowInitialized:aConfig:paneConfigPref - " +
          aMsgWindowInitialized +
          ":" +
          aConfig +
          ":" +
          this.paneConfigPref
      );

    let paneConfig = aConfig ?? this.paneConfigPref;

    this.DEBUG &&
      console.debug(
        "UpdateMailPaneConfig: paneConfig:gCurrentPaneConfig:" +
          "isAccountCentralLoaded:isCurrentTabModeFolder " +
          paneConfig +
          ":" +
          this.gCurrentPaneConfig +
          ":" +
          this.isAccountCentralLoaded +
          ":" +
          this.isCurrentTabModeFolder
      );

    let paneConfigMap = this.paneConfigMap[paneConfig];

    // Set to standard/classic if in accountcentral and widethread or stacked
    // layout, so accountcentral displays correctly. Pre startup completed, the
    // state is in flux, depending on timing and variation of OS, so only do
    // this post startup.
    if (this.isAccountCentralLoaded && paneConfigMap.accountcentralReset) {
      // In widethread reversed, when selecting a folder when in accountcentral,
      // a drag event is simulated as the click happens after the folder has
      // moved away from the cursor. Remove this attribute on a setTimeout to
      // effect the css after the click completes.
      this.e(paneConfigMap.reverseboxId).setAttribute("accountcentral", true);

      paneConfig = this.kStandardPaneConfig;
      paneConfigMap = this.paneConfigMap[paneConfig];
    }

    // Set view name for css selectors.
    let mailContent = this.e("mailContent");
    let viewName = this.isAccountCentralLoaded
      ? "accountcentral"
      : paneConfigMap.viewName;
    mailContent.setAttribute("layout", viewName);

    console.info("UpdateMailPaneConfig: layout --> " + viewName);

    if (paneConfig == this.gCurrentPaneConfig) {
      // No change required.
      return;
    }

    this.DEBUG && console.debug("UpdateMailPaneConfig: CONTINUE");
    let rerootThreadPane = false;
    let desiredMessagepaneParentId = paneConfigMap.messagepaneParentId;
    let desiredThreadpaneParentId = paneConfigMap.threadpaneParentId;
    // eslint-disable-next-line prettier/prettier
    let desiredThreadpanesplitterParentId = paneConfigMap.threadpanesplitterParentId;

    // threadpane+acct central.
    let displayBox = this.e("displayBox");
    let threadAndMessagePaneSplitter = GetThreadAndMessagePaneSplitter();
    let messagePaneBoxWrapper = GetMessagePaneWrapper();

    this.DEBUG &&
      console.debug(
        "UpdateMailPaneConfig: messagePaneBoxWrapper, parent:desiredParent - " +
          messagePaneBoxWrapper.parentNode.id +
          ":" +
          desiredMessagepaneParentId
      );

    FolderPaneController.notificationBox.removeAllNotifications();
    let lastActiveElement = document.activeElement;

    if (messagePaneBoxWrapper.parentNode.id != desiredMessagepaneParentId) {
      // Only for non multimessage view.
      if (gMessageDisplay && gMessageDisplay.singleMessageDisplay) {
        ClearAttachmentList();
      }

      let desiredParent = this.e(desiredMessagepaneParentId);
      desiredParent.appendChild(threadAndMessagePaneSplitter);
      desiredParent.appendChild(messagePaneBoxWrapper);

      // Reconnect the message pane's web progress listener.
      let messagePane = document.getElementById("messagepane");
      if (messagePane._progressListener) {
        messagePane.webProgress.addProgressListener(
          messagePane._progressListener,
          Ci.nsIWebProgress.NOTIFY_ALL
        );
      }

      if (msgWindow) {
        // Reassigning statusFeedback adds a progress listener to the new docShell.
        // eslint-disable-next-line no-self-assign
        msgWindow.statusFeedback = msgWindow.statusFeedback;
      }
    }

    this.DEBUG &&
      console.debug(
        "UpdateMailPaneConfig: displayBox - parent:desiredParent - " +
          displayBox.parentNode.id +
          ":" +
          desiredThreadpaneParentId
      );
    this.DEBUG &&
      console.debug(
        "UpdateMailPaneConfig: threadpane-splitter - parent:desiredParent - " +
          threadAndMessagePaneSplitter.parentNode.id +
          ":" +
          desiredThreadpanesplitterParentId
      );

    if (displayBox.parentNode.id != desiredThreadpaneParentId) {
      let desiredParent = this.e(desiredThreadpaneParentId);
      let desiredParentSplitter = this.e(desiredThreadpanesplitterParentId);
      switch (paneConfig) {
        case this.kStandardPaneConfig: // 0
        case this.kWideThreadPaneConfig: // 3
          desiredParent.insertBefore(displayBox, desiredParent.lastChild);
          break;
        case this.kWidePaneConfig: // 1
        case this.kVerticalPaneConfig: // 2
        case this.kStackedPaneConfig: // 4
          desiredParent.appendChild(displayBox);
          break;
      }

      // Make sure splitter is in the right place.
      desiredParentSplitter.insertBefore(
        threadAndMessagePaneSplitter,
        desiredParentSplitter.lastChild
      );

      rerootThreadPane = true;
    }

    // Set element orient states for a given view.
    threadAndMessagePaneSplitter.setAttribute(
      "orient",
      paneConfigMap.threadpanesplitterOrient
    );

    // Make sure dimensions always maintained as set.  Also set flex on a tab
    // change for non 3pane.
    // eslint-disable-next-line prettier/prettier
    messagePaneBoxWrapper.setAttribute("flex", paneConfigMap.messagepaneboxwrapperFlex);
    displayBox.setAttribute("flex", paneConfigMap.threadpaneParentFlex);

    // Record the new configuration, set the pref in case changed manually
    // (unless we're switching layout for fullscreen).
    this.gCurrentPaneConfig = paneConfig;
    if (!this.isAccountCentralLoaded && !aConfig) {
      this.paneConfigPref = paneConfig;
    }

    // Reset msgWindow after move.
    if (aMsgWindowInitialized && !this.isAccountCentralLoaded) {
      this.rerootMsgWindow();

      if (rerootThreadPane) {
        // Also reset threadpane references after move, if necessary.
        this.rerootThreadPane();
      }

      // Reinit the findbar browser. Still necessary in Tb85.
      this.e("FindToolbar").browser;
      this.e("FindToolbar").browser._finder = null;
      this.e("FindToolbar").browser.finder;
      this.DEBUG && console.debug("UpdateMailPaneConfig: reset FindToolbar");

      // For some layout changes, the doc in messagepane or multimessage is
      // not destroyed, so only create it again if it has been (meaning url is
      // about:blank).
      if (getBrowser()?.webNavigation.currentURI.spec == "about:blank") {
        this.DEBUG && console.debug("UpdateMailPaneConfig: about:blank");
        if (!gMessageDisplay.singleMessageDisplay) {
          gSummaryFrameManager.pendingOrLoadedUrl = "about:blank";
        }
        gMessageDisplay.makeInactive();
        setTimeout(() => {
          gFolderDisplay.makeActive();
          if (paneConfigMap.accountcentralReset) {
            // eslint-disable-next-line prettier/prettier
            this.e(paneConfigMap.reverseboxId).removeAttribute("accountcentral");
          }
        });
      }
    }

    lastActiveElement.focus();
  },
  /* eslint-enable complexity */

  /*
   * Reverse the layout.
   *
   * @param {Event} event - Event from target menuitem/button.
   */
  reverseLayout(event) {
    let paneconfig = this[event.target.getAttribute("paneconfig")];
    // On osx, system menu bar menuitem |checked| is set to false, not removed.
    let reverse = event.target.getAttribute("checked") == "true";
    let paneConfigMap = this.paneConfigMap[paneconfig];
    let desiredReverseBoxId = paneConfigMap.reverseboxId;
    this.e(desiredReverseBoxId).toggleAttribute("reverse", reverse);
    console.info(
      "reverseLayout: " +
        paneConfigMap.viewName +
        " --> " +
        (reverse ? "reverse" : "unreverse")
    );
  },

  // Grrr.
  updateStackedGlodaList() {
    this.e("folderPaneBox").collapsed = false;
    this.e("folderpane_splitter").collapsed = false;
    this.e("folderpane_splitter").setAttribute("state", "open");
    this.e("displayBox").collapsed = false;
    this.e("displayBox").setAttribute("flex", "1");
    this.e("threadpane-splitter").setAttribute("collapse", "before");
    this.e("threadpane-splitter").collapsed = true;
    this.e("threadpane-splitter").setAttribute("state", "collapsed");
  },

  /*
   * Set the splitter height.
   */
  OnMouseUpHeaderSplitter() {
    this.setHeaderSplitter();
  },

  /*
   * Set the splitter height.
   */
  setHeaderSplitter() {
    let msgHeaderView = this.e("msgHeaderView");
    let splitter = this.e("header-splitter");
    let height = Services.xulStore.getValue(
      document.URL,
      "msgHeaderView",
      "height"
    );
    this.DEBUG && console.debug("setHeaderSplitter: height1 - " + height);
    if (height === "") {
      height = msgHeaderView.clientHeight;
    } else {
      msgHeaderView.style.height = height == 0 ? 0 : height + "px";
    }
    msgHeaderView.collapsed = gFolderDisplay?.selectedCount !== 1;
    msgHeaderView.setAttribute("height", height);
    splitter.setAttribute("state", height == 0 ? "collapsed" : "");
    this.DEBUG && console.debug("setHeaderSplitter: height2 - " + height);
  },

  /*
   * Add a splitter to size the header pane.
   */
  InitMessageHeaderLayout() {
    this.DEBUG && console.debug("InitMessageHeaderLayout: START");
    let msgHeaderView = this.e("msgHeaderView");
    //let headerSplitter = document.createElement("hr", { is: "pane-splitter" });
    //headerSplitter.id = "header-splitter";
    msgHeaderView?.parentElement.insertBefore(
      //headerSplitter,
      MozXULElement.parseXULToFragment(`
        <splitter id="header-splitter"
                  orient="vertical"
                  collapse="before"
                  onmouseup="MoreLayouts.OnMouseUpHeaderSplitter()"/>
      `),
      msgHeaderView?.nextElementSibling
    );

    let messagepanewrapper = this.e("messagepanewrapper");
    messagepanewrapper.parentElement.insertBefore(
      this.e("imip-bar"),
      messagepanewrapper
    );
    messagepanewrapper.parentElement.insertBefore(
      this.e("mail-notification-top"),
      messagepanewrapper
    );

    this.setHeaderSplitter();
    msgHeaderView.setAttribute("persist", "height");
  },

  /*
   * Add a toggle for attachment list message location.
   * On attachment list icon toggle, change the list location.
   *
   * @param {ChromeWindow} win - Either 3pane or compose.
   */
  InitAttachmentListLayout(win) {
    let doc = win?.document;
    let winType = doc?.documentElement.attributes?.windowtype?.value;
    this.DEBUG &&
      console.debug("InitAttachmentListLayout: winType - " + winType);

    let location = this.attachmentListLocationMessagePref;
    let attachmentToggle = this.e("attachmentToggle", doc);
    let attachmentIcon = this.e("attachmentIcon", doc);
    let attachmentCount = this.e("attachmentCount", doc);
    let attachmentBucket = this.e("attachmentBucket", doc);
    let outlineColorStyle =
      "outline-color: var(--toolbar-field-focus-border-color);";

    if (winType == "msgcompose") {
      location = this.kAttachmentListLocationComposeDefault;
      let headersParent = this.e("composeContentBox", doc);
      headersParent.setAttribute("attachmentlistlocation", location);
      let MsgHeadersToolbar = this.e("MsgHeadersToolbar", doc);
      let attachmentSplitter = this.e("attachmentSplitter", doc);
      let attachmentArea = this.e("attachmentArea", doc);
      attachmentCount = this.e("attachmentBucketCount", doc);

      let height = Services.xulStore.getValue(
        doc.URL,
        attachmentSplitter.id,
        "height"
      );
      let width = Services.xulStore.getValue(
        doc.URL,
        attachmentSplitter.id,
        "width"
      );

      this.DEBUG &&
        console.debug(
          "InitAttachmentListLayout: splitter height:width - " +
            height +
            ":" +
            width
        );

      if (height) {
        attachmentSplitter.height = height;
      }
      if (width) {
        attachmentSplitter.width = width;
        this.DEBUG && console.debug(MsgHeadersToolbar.style);
      }

      attachmentToggle?.classList.add("plain-button");
      // Make the compose show list toggle work with keypress.
      const onToggleAttachmentPane = event => {
        if (event.type == "toggle") {
          if (
            MoreLayouts.attachmentListLocationComposePref !=
            MoreLayouts.kAttachmentListLocationComposeDefault
          ) {
            attachmentArea.open = true;
            setTimeout(() => {
              attachmentArea.querySelector("summary").removeAttribute("title");
            }, 100);
          }
          return;
        }
        if (event.type == "keypress" && event.code != "Space") {
          return;
        }
        event.stopPropagation();
        win.toggleAttachmentPane(attachmentArea.open ? "hide" : "show");
      };

      attachmentArea?.addEventListener(
        "toggle",
        event => onToggleAttachmentPane(event),
        { capture: false }
      );
      attachmentToggle?.addEventListener(
        "keypress",
        event => onToggleAttachmentPane(event),
        { capture: true }
      );
      // Add the attachment icon, for message header parity. Need class for
      // context properties.
      attachmentToggle?.parentElement.insertBefore(
        MozXULElement.parseXULToFragment(`
        <html:img id="attachmentIcon"
                  class="toolbarbutton-1"
                  src="chrome://messenger/skin/icons/attach.svg"
                  alt="" />
        `),
        attachmentCount
      );
      attachmentIcon = this.e("attachmentIcon", doc);

      attachmentSplitter.addEventListener("splitter-resized", () => {
        if (attachmentSplitter.resizeDirection == "vertical") {
          Services.xulStore.setValue(
            doc.URL,
            attachmentSplitter.id,
            "height",
            Math.round(attachmentSplitter.height)
          );
        } else {
          Services.xulStore.setValue(
            doc.URL,
            attachmentSplitter.id,
            "width",
            Math.round(attachmentSplitter.width)
          );
        }
      });
    } else {
      attachmentToggle?.setAttribute("tabindex", "0");
      attachmentToggle?.classList.add("themeable-brighttext");
    }

    this.setAttachmentLocationStr(attachmentIcon, location);

    attachmentCount?.setAttribute("crop", "end");
    attachmentBucket?.setAttribute("style", outlineColorStyle);
  },

  /*
   * Change the list location.
   * TODO: removed with icon toggle; restore as menuitems in message/compose.
   *
   * @param {Event} event - Click event.
   */
  ChangeAttachmentListLayout(event) {
    if (event.type == "keypress" && event.code != "Space") {
      return;
    }
    event.stopPropagation();
    let self = MoreLayouts;
    let win = event.target.ownerGlobal;
    let winType = win.document.documentElement.attributes?.windowtype?.value;
    self.DEBUG && console.debug(winType);
    self.DEBUG && console.debug(event);
    let locations, curLocation, prefKey;
    let storageLocalData = {};
    if (winType == "msgcompose") {
      locations = Object.keys(self.attachmentListComposeConfigMap);
      curLocation = self.attachmentListLocationComposePref;
      prefKey = "attachmentListLocationCompose";
    } else {
      locations = Object.keys(self.attachmentListConfigMap);
      curLocation = self.attachmentListLocationMessagePref;
      prefKey = "attachmentListLocationMessage";
    }

    let curIndex = locations.indexOf(curLocation);
    let newLocation =
      ++curIndex >= locations.length ? locations[0] : locations[curIndex];
    self.DEBUG &&
      console.debug(
        "ChangeAttachmentListLayout: curLocation:newLocation:locations - " +
          curLocation +
          ":" +
          newLocation +
          ":" +
          locations
      );
    storageLocalData[prefKey] = newLocation;
    // eslint-disable-next-line prettier/prettier
    self.getWXAPI(self.extensionInfo, "storage", true).local.set(storageLocalData);
    setTimeout(() => {
      self.DEBUG &&
        console.debug(
          "ChangeAttachmentListLayout: focus - " + self._activeElement.id
        );
      self._activeElement.focus();
      delete self._activeElement;
    }, 100);
  },

  /*
   * @param {String} location - A value in ["top", "right", "bottom", "left"],
   *                            or ["top", "bottom"] for compose window.
   * @param {Window} win
   */
  UpdateAttachmentListLayout(location, win) {
    let doc = win?.document;
    let winType = doc?.documentElement.attributes?.windowtype?.value;
    if (winType == "msgcompose") {
      // Compose window attachment list location.
      location =
        location && this.attachmentListComposeConfigMap[location]
          ? location
          : this.attachmentListLocationComposePref;
      let alwaysShow = this.attachmentListAlwaysShowPref;
      let configMap = this.attachmentListComposeConfigMap[location];

      let headersParent = this.e("composeContentBox", doc);
      let attachmentArea = this.e("attachmentArea", doc);
      let attachmentSplitter = this.e("attachmentSplitter", doc);
      let attachmentIcon = this.e("attachmentIcon", doc);
      let attachmentList = this.e("attachmentBucket", doc);
      let splitterDirection = configMap.splitterDirection;
      let vertical = splitterDirection == "vertical";
      let activeElement = doc.activeElement;

      let open =
        ((alwaysShow || attachmentList.itemCount > 0) &&
          this.kAttachmentListLocationComposeDefault != location) ||
        (this.attachmentListAlwaysShowOpenComposePref &&
          this.kAttachmentListLocationComposeDefault == location);

      this.DEBUG &&
        console.debug(
          "UpdateAttachmentListLayout: compose alwaysShow:open:location:parentId:activeElementId - " +
            alwaysShow +
            ":" +
            open +
            ":" +
            location +
            ":" +
            configMap.parentId +
            ":" +
            activeElement.id
        );

      alwaysShow =
        alwaysShow ||
        (attachmentList.itemCount > 0 &&
          this.kAttachmentListLocationComposeDefault != location);

      headersParent.toggleAttribute("attachmentlistalwaysshow", alwaysShow);
      attachmentSplitter.removeAttribute(vertical ? "width" : "height");
      attachmentArea.open = open;

      // No tabstop on a <summary> element on "top" location.
      attachmentArea.firstElementChild?.setAttribute(
        "tabindex",
        location == this.kAttachmentListLocationComposeDefault ? "0" : "-1"
      );

      if (
        (headersParent.getAttribute("attachmentlistlocation") ??
          this.kAttachmentListLocationComposeDefault) == location
      ) {
        return;
      }

      let parentId = configMap.parentId;
      let desiredParent = this.e(parentId, doc);

      desiredParent.appendChild(attachmentSplitter);
      desiredParent.appendChild(attachmentArea);
      attachmentSplitter.setAttribute("resize-direction", splitterDirection);
      headersParent.setAttribute("attachmentlistlocation", location);
      this.setAttachmentLocationStr(attachmentIcon, location);

      // Bad code for vertical, fix up.
      let element = attachmentSplitter._resizeElement;
      let beforeElement =
        element &&
        !!(
          attachmentSplitter.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING
        );
      let ltrDir = attachmentSplitter.ownerDocument.body.matches(":dir(ltr)");
      attachmentSplitter._beforeElement = vertical
        ? beforeElement
        : beforeElement != ltrDir;

      attachmentSplitter._updateStyling();
      // Don't use the setter so persisted width/height isn't forgotten.
      attachmentSplitter.removeAttribute(vertical ? "width" : "height");
      if (!vertical) {
        headersParent.style.removeProperty(attachmentSplitter._cssName.height);
      }

      // Required for context menus to be correct.
      attachmentList.clearSelection();
      attachmentList.controllers.appendController(
        win.attachmentBucketController
      );

      setTimeout(() => {
        activeElement.focus();
        this.DEBUG &&
          console.debug(
            "UpdateAttachmentListLayout: focus activeElementId - " +
              doc.activeElement.id
          );
      }, 0);

      return;
    }

    location =
      location && this.attachmentListConfigMap[location]
        ? location
        : this.attachmentListLocationMessagePref;
    this.DEBUG &&
      console.debug("UpdateAttachmentListLayout: location - " + location);

    let configMap = this.attachmentListConfigMap[location];
    let attachmentView = this.e("attachmentView");
    let attachmentSplitter = this.e("attachment-splitter");
    let attachmentList = this.e("attachmentList");
    let attachmentIcon = this.e("attachmentIcon");

    let parentId = configMap.parentId;
    let insertBeforeId = configMap.insertbeforeId;
    let splitterOrient = configMap.splitterOrient;
    let splitterCollapse = configMap.splitterCollapse;

    let desiredParent = this.e(parentId);
    let insertBefore = this.e(insertBeforeId);

    switch (location) {
      case "top":
        desiredParent = insertBefore.parentElement;
        desiredParent.insertBefore(attachmentView, insertBefore);
        desiredParent.insertBefore(attachmentSplitter, insertBefore);
        attachmentSplitter.setAttribute("resizebefore", "closest");
        attachmentSplitter.setAttribute("resizeafter", "closest");
        break;
      case "right":
        desiredParent.appendChild(attachmentSplitter);
        desiredParent.appendChild(attachmentView);
        attachmentSplitter.removeAttribute("resizebefore");
        attachmentSplitter.removeAttribute("resizeafter");
        break;
      case "bottom":
        desiredParent.appendChild(attachmentSplitter);
        desiredParent.appendChild(attachmentView);
        attachmentSplitter.setAttribute("resizebefore", "closest");
        attachmentSplitter.setAttribute("resizeafter", "closest");
        break;
      case "left":
        insertBefore = desiredParent.firstElementChild;
        desiredParent.insertBefore(attachmentView, insertBefore);
        desiredParent.insertBefore(attachmentSplitter, insertBefore);
        attachmentSplitter.removeAttribute("resizebefore");
        attachmentSplitter.removeAttribute("resizeafter");
        break;
    }

    this.e("mail-notification-top").removeAttribute("height");

    attachmentView.setAttribute("location", location);

    this.setAttachmentLocationStr(attachmentIcon, location);

    attachmentList.setAttribute(
      "orient",
      splitterOrient == "horizontal" ? "vertical" : "horizontal"
    );
    attachmentSplitter.setAttribute("orient", splitterOrient);
    attachmentSplitter.setAttribute("collapse", splitterCollapse);

    let locationTopOrBottom = ["top", "bottom"].includes(location);
    let open =
      !locationTopOrBottom ||
      (this.attachmentListAlwaysShowOpenMessagePref && locationTopOrBottom);

    this.DEBUG && console.debug("UpdateAttachmentListLayout: open - " + open);
    toggleAttachmentList(open);
  },

  /**
   * Set the attachment list location tooltip on a toggle node.
   *
   * @param {String} state - A value in ["top", "right", "bottom", "left"].
   *
   * @returns {String} - Presentation/localized string.
   */
  setAttachmentLocationStr(attachmentNode, location) {
    let locStr = location.replace(
      location.charAt(0),
      location.charAt(0).toUpperCase()
    );
    attachmentNode.setAttribute(
      "title",
      this.getLocaleMessage(`attachmentListLocation${locStr}`)
    );
  },

  /**
   * Set splitter collapse states to effect the passed message pane state parm.
   *
   * @param {String} state - Value in "normal", "min", "max".
   *
   * @returns {Boolean} - True if a change was made, else false.
   */
  MessagePaneMaxShowHide(state) {
    this.DEBUG &&
      console.debug(
        "MessagePaneMaxShowHide: mode:current:prior:setState:isFolderPaneUserCollapsed - " +
          this.messagePaneToggleModePref +
          ":" +
          this.gCurrentMessagePaneConfig +
          ":" +
          this.gPriorMessagePaneConfig +
          ":" +
          state +
          ":" +
          this.isFolderPaneUserCollapsed
      );

    let widethread = this.gCurrentPaneConfig == this.kWideThreadPaneConfig;
    let stacked = this.gCurrentPaneConfig == this.kStackedPaneConfig;
    let threadSplitter = this.e("threadpane-splitter");
    let folderSplitter = this.e("folderpane_splitter");
    let messagepanebox = this.e("messagepanebox");
    let messagepaneboxwrapper = this.e("messagepaneboxwrapper");
    let folderPaneBox = this.e("folderPaneBox");

    let setFolderSplitter = !this.isFolderPaneUserCollapsed;

    if (this.isFolderPaneUserCollapsed && stacked) {
      this.isFolderPaneUserCollapsed = false;
      folderSplitter.setAttribute("state", "open");
      folderPaneBox.setAttribute("width", folderPaneBox.clientWidth);
      folderPaneBox.setAttribute("flex", 1);
      return true;
    }

    if (state == this.kMessagePaneNormal) {
      if (widethread || stacked) {
        folderPaneBox.removeAttribute("flex");
      }

      this.e("threadContentArea").removeAttribute("collapsed");
      threadSplitter.setAttribute("collapse", "after");
      threadSplitter.setAttribute("state", "open");

      if (setFolderSplitter) {
        folderSplitter.setAttribute("collapse", "before");
        folderSplitter.setAttribute("state", "open");
      }

      messagepaneboxwrapper.setAttribute(
        "flex",
        this.paneConfigMap[this.gCurrentPaneConfig].messagepaneboxwrapperFlex
      );
    } else if (state == this.kMessagePaneMin) {
      if (widethread || stacked) {
        threadSplitter.setAttribute(
          "state",
          gFolderDisplay.folderPaneVisible || stacked ? "open" : "collapsed"
        );

        if (setFolderSplitter) {
          folderSplitter.setAttribute("collapse", "after");
          folderSplitter.setAttribute("state", "collapsed");
          folderPaneBox.setAttribute("flex", 1);
        }
      } else {
        if (setFolderSplitter) {
          folderSplitter.setAttribute("state", "open");
        }
        threadSplitter.setAttribute("state", "collapsed");
      }
    } else if (state == this.kMessagePaneMax) {
      if (GetNumSelectedMessages() < 1) {
        return false;
      }

      threadSplitter.removeAttribute("substate");
      threadSplitter.setAttribute("collapse", "before");
      threadSplitter.setAttribute("state", "collapsed");

      if (setFolderSplitter) {
        folderSplitter.removeAttribute("substate");
        folderSplitter.setAttribute("collapse", "before");
        folderSplitter.setAttribute("state", "collapsed");
      }

      messagepaneboxwrapper.setAttribute(
        "flex",
        this.paneConfigMap[this.kStandardPaneConfig].messagepaneboxwrapperFlex
      );
    }

    messagepanebox.setAttribute("togglestate", state);
    return true;
  },

  /**
   * An F8 three way max-normal-min message pane toggle function.
   *
   * @returns {void}
   */
  MsgToggleMessagePane() {
    if (!this.isCurrentTabModeFolder) {
      // Bail without doing anything if we are not a folder tab. Not enabled
      // for glodaList.
      return;
    }

    this.DEBUG && console.debug("MsgToggleMessagePane: START");

    let setState;
    let currentTabFolderDisplay = null;
    let currentMessagePaneConfig = this.gCurrentMessagePaneConfig;
    let priorMessagePaneConfig = this.gPriorMessagePaneConfig;

    if (
      // No sense in F8 with collapsed folderpane.
      this.isFolderPaneUserCollapsed &&
      this.gCurrentPaneConfig == this.kStackedPaneConfig
    ) {
      return;
    }

    if (this.currentTabInfo.folderDisplay) {
      currentTabFolderDisplay = this.currentTabInfo.folderDisplay;
      if (currentTabFolderDisplay.messagePaneStatePrior) {
        priorMessagePaneConfig = currentTabFolderDisplay.messagePaneStatePrior;
      }
    }

    if (
      [this.kMessagePaneMin, this.kMessagePaneMax].includes(
        currentMessagePaneConfig
      )
    ) {
      setState = this.kMessagePaneNormal;
    } else if (this.messagePaneToggleModePref == this.kToggleCycle) {
      setState =
        priorMessagePaneConfig == this.kMessagePaneMax
          ? this.kMessagePaneMin
          : this.kMessagePaneMax;
    } else {
      setState =
        this.messagePaneToggleModePref == this.kToggleNormalMin
          ? this.kMessagePaneMin
          : this.kMessagePaneMax;
    }

    if (!this.MessagePaneMaxShowHide(setState)) {
      return;
    }

    this.gPriorMessagePaneConfig = this.gCurrentMessagePaneConfig;
    this.gCurrentMessagePaneConfig = setState;
    if (currentTabFolderDisplay) {
      currentTabFolderDisplay.messagePaneStatePrior =
        currentTabFolderDisplay.messagePaneState;
      currentTabFolderDisplay.messagePaneState = setState;
    }

    ChangeMessagePaneVisibility(IsMessagePaneCollapsed());
    SetFocusThreadPaneIfNotOnMessagePane();
  },

  /**
   * An F11 fullscreen function.
   *
   * @returns {void}
   */
  BrowserFullScreen() {
    this.DEBUG && console.debug("BrowserFullScreen: " + window.fullScreen);
    let fullscreen = window.fullScreen;
    let fullscreenLayoutPref = this.fullscreenLayoutPref;
    let desiredPaneConfig = this.paneConfigPref;
    if (!fullscreen && fullscreenLayoutPref != this.kFullscreenLayoutDefault) {
      desiredPaneConfig = fullscreenLayoutPref;
    }

    if (desiredPaneConfig != this.gCurrentPaneConfig) {
      UpdateMailPaneConfig(true, desiredPaneConfig);
      this.DEBUG &&
        console.debug(
          "BrowserFullScreen: done UpdateMailPaneConfig - " +
            this.gCurrentPaneConfig
        );
    }

    this.e("toolbar-menubar").setAttribute("collapsed", !fullscreen);
    // this.e("mail-toolbox").setAttribute("collapsed", !fullscreen);
    // this.e("status-bar").setAttribute("collapsed", !fullscreen);
    this.e("menu_fullScreenML").setAttribute("checked", !fullscreen);
    this.e("appmenu_menu_fullScreenML").checked = !fullscreen;

    // If not in fullscreen, set to fullscreen, and vice versa.
    window.fullScreen = !fullscreen;

    if (this.isCurrentTabModeFolder) {
      this.MessagePaneMaxShowHide(this.gCurrentMessagePaneConfig);
    }
  },
}; // MoreLayouts

MoreLayouts.onLoad();
