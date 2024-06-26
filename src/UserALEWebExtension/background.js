/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 eslint-disable
 */

import * as MessageTypes from "./messageTypes.js";
import * as userale from "../main.js";
import { browser } from "./globals.js";

// Initalize userale plugin options
const defaultConfig = {
  useraleConfig: {
    url: "http://localhost:8000",
    userId: "pluginUser",
    authHeader: null,
    toolName: "useralePlugin",
    version: userale.version,
  },
  pluginConfig: {
    // Default to a regex that will match no string
    urlWhitelist: "(?!x)x",
  },
};

var urlWhitelist;
var tabToHttpSession = {};
var browserSessionId = null;

/**
 * Apply the extension config to both the background and content instances of userale
 * @param {Object} config The extension config to apply
 * @return {undefined}
 */
function updateConfig(config) {
  urlWhitelist = new RegExp(config.pluginConfig.urlWhitelist);
  userale.options(config.useraleConfig);
  // TODO: tabs need a page load to apply this config change.
  dispatchTabMessage(config.useraleConfig);
}

/**
 * Send a message to all tabs
 * @param {Object} message The message to send
 * @return {undefined}
 */
function dispatchTabMessage(message) {
  browser.tabs.query({}, function (tabs) {
    tabs.forEach(function (tab) {
      browser.tabs.sendMessage(tab.id, message);
    });
  });
}

/**
 * Callback for filtering out logs with urls that do not match the regex defined in extension options.
 * @param {Object} log The candidate log
 * @return {Object} The transformed log
 */
function filterUrl(log) {
  if (urlWhitelist.test(log.pageUrl)) {
    return log;
  }
  return false;
}

/**
 * Callback for setting the session id's of tab logs to that of the target tab
 * @param {Object} log The candidate log
 * @return {Object} The transformed log
 */
function injectSessions(log) {
  let id = log.details.id;
  if (id in tabToHttpSession) {
    log.httpSessionId = tabToHttpSession[id];
  } else {
    log.httpSessionId = null;
  }
  log.browserSessionId = browserSessionId;
  return log;
}

browser.storage.local.get(defaultConfig, (res) => {
  // Apply url filter to logs generated by the background page.
  userale.addCallbacks({ filterUrl, injectSessions });
  updateConfig(res);
  browserSessionId = JSON.parse(
    window.sessionStorage.getItem("userAleHttpSessionId"),
  );
});

browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  switch (message.type) {
    // Handles logs rerouted from content and option scripts.
    case MessageTypes.ADD_LOG:
      let log = message.payload;
      log.browserSessionId = browserSessionId;
      // Apply url filter to logs generated outside the background page.
      log = filterUrl(log);
      if (log) {
        userale.log(log);
      }
      break;

    case MessageTypes.HTTP_SESSION:
      if ("tab" in sender && "id" in sender.tab) {
        tabToHttpSession[sender.tab.id] = message.payload;
      }
      break;

    case MessageTypes.CONFIG_CHANGE:
      updateConfig(message.payload);
      break;

    default:
      console.log("got unknown message type ", message);
  }
});

/**
 * Extract tab details then log a tab event
 * @param {integer} tabId The id of the target tab
 * @param {Object} data The data of the tab event
 * @param {String} type The type of tab event
 * @return {undefined}
 */
function packageTabLog(tabId, data, type) {
  browser.tabs.get(tabId, (tab) => {
    packageDetailedTabLog(tab, data, type);
  });
}

/**
 * Log a tab event with tab details
 * @param {Object} tab The target tab object
 * @param {Object} data The data of the tab event
 * @param {String} type The type of tab event
 * @return {undefined}
 */
function packageDetailedTabLog(tab, data, type) {
  Object.assign(data, { type });
  userale.packageCustomLog(
    data,
    () => {
      return tab;
    },
    true,
  );
}

// Attach Handlers for tab events
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs
browser.tabs.onActivated.addListener((activeInfo) => {
  packageTabLog(activeInfo.tabId, activeInfo, "tabs.onActivated");
});

browser.tabs.onAttached.addListener((tabId, attachInfo) => {
  packageTabLog(tabId, attachInfo, "tabs.onAttached");
});

browser.tabs.onCreated.addListener((tab) => {
  packageDetailedTabLog(tab, {}, "tabs.onCreated");
});

browser.tabs.onDetached.addListener((tabId, detachInfo) => {
  packageTabLog(tabId, detachInfo, "tabs.onDetached");
});

browser.tabs.onMoved.addListener((tabId, moveInfo) => {
  packageTabLog(tabId, moveInfo, "tabs.onMoved");
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  packageDetailedTabLog({ id: tabId }, removeInfo, "tabs.onRemoved");
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  packageDetailedTabLog(tab, changeInfo, "tabs.onUpdated");
});

browser.tabs.onZoomChange.addListener((ZoomChangeInfo) => {
  packageTabLog(ZoomChangeInfo.tabId, ZoomChangeInfo, "tabs.onZoomChange");
});

/*
 eslint-enable
 */
