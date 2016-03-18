/* globals Services, Locale */

const tabs = require("sdk/tabs");
const {Cu} = require("chrome");
const self = require("sdk/self");

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Locale.jsm");

function TabTracker(trackableURLs, clientID) {
  this._tabData = {};

  this._clientID = clientID;
  this._trackableURLs = trackableURLs;
  this.onOpen = this.onOpen.bind(this);
  tabs.on("open", this.onOpen);
}

TabTracker.prototype = {
  _openTabs: [],

  get tabData() {
    return this._tabData;
  },

  uninit: function() {
    for (let tab of this._openTabs) {
      tab.removeListener("ready", this.logReady);
      tab.removeListener("activate", this.logActivate);
      tab.removeListener("deactivate", this.logDeactivate);
      tab.removeListener("close", this.logDeactivate);
    }
    tabs.removeListener("open", this.onOpen);
  },

  isActivityStreamsURL: function(URL) {
    return this._trackableURLs.indexOf(URL) !== -1;
  },

  navigateAwayFromPage: function(tab, reason) {
    this._tabData.unload_reason = reason;
    this._tabData.client_id = this._clientID;
    this._tabData.addon_version = self.version;
    this._tabData.locale = Locale.getLocale();
    this._tabData.load_reason = "other";
    this._tabData.source = "other";

    if (!this._tabData.tab_id) {
      // We're navigating away from an activity streams page that
      // didn't even load yet. Let's say it's been active for 0 seconds.
      this._tabData.url = tab.url;
      this._tabData.tab_id = tab.id;
      this._tabData.session_duration = 0;
      delete this._tabData.start_time;
      Services.obs.notifyObservers(null, "tab-session-complete", JSON.stringify(this._tabData));
      this._tabData = {};
      return;
    }
    if (this._tabData.start_time) {
      this._tabData.session_duration = (Date.now() - this._tabData.start_time);
      delete this._tabData.start_time;
    }
    Services.obs.notifyObservers(null, "tab-session-complete", JSON.stringify(this._tabData));
    this._tabData = {};
  },

  logReady: function(tab) {
    if (this.isActivityStreamsURL(tab.url)) {
      if (!this._tabData.url) {
        this._tabData.url = tab.url;
        this._tabData.tab_id = tab.id;
      } else if (!this._tabData.session_duration) {
        // The page content has been reloaded but a total time wasn't set.
        // This is due to a page refresh. Let's set the total time now.
        this.navigateAwayFromPage(tab, "refresh");
      }
      this.logActivate(tab);
      return;
    }
    // We loaded a URL other than activity streams. If the last open URL
    // in this tab was activity streams (session_duration hasn't been set yet),
    // then update its state.
    if (!this._tabData.session_duration) {
      this.navigateAwayFromPage(tab, "navigation");
    }
  },

  logActivate: function(tab) {
    if (this.isActivityStreamsURL(tab.url)) {
      this._tabData.start_time = Date.now();
    }
  },

  logDeactivate: function(reason) {
    return function(tab) {
      if (this.isActivityStreamsURL(tab.url)) {
        this.navigateAwayFromPage(tab, reason);
      }
    }.bind(this);
  },

  logClose: function(reason) {
    return function(tab) {
      if (tabs.activeTab.id !== tab.id) {
        // Closing an inactive tab should have no effect
        return;
      }
      this.logDeactivate(reason)(tab);
    }.bind(this);
  },

  onOpen: function(tab) {
    this._openTabs.push(tab);

    this.logReady = this.logReady.bind(this);
    this.logActivate = this.logActivate.bind(this);
    this.logDeactivate = this.logDeactivate.bind(this);

    tab.on("ready", this.logReady);
    tab.on("activate", this.logActivate);
    tab.on("deactivate", this.logDeactivate("unfocus"));
    tab.on("close", this.logClose("close"));
  },
};

exports.TabTracker = TabTracker;
