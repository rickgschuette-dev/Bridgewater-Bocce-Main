// Bridgewater Bocce - "Add This to Your Phone" install banner
//
// This only ever appears when the browser itself signals that a one-tap
// install is available (Android Chrome-family browsers: Chrome, Edge,
// Samsung Internet, Brave, etc. -- this site's manifest.json and sw.js
// already meet the requirements those browsers check for). iPhone Safari
// and any browser that doesn't support this simply never fires the event
// below, so the banner stays hidden there automatically -- nothing extra
// to detect or build per platform.
(function () {
  "use strict";

  var deferredPrompt = null;
  var banner = document.getElementById("install-banner");
  var installBtn = document.getElementById("install-banner-btn");
  var dismissBtn = document.getElementById("install-banner-dismiss");

  if (!banner || !installBtn) return;

  function showBanner() {
    var dismissed = false;
    try {
      dismissed = sessionStorage.getItem("bbtlInstallBannerDismissed") === "1";
    } catch (e) {
      // sessionStorage unavailable (private browsing, etc.) -- just show it
    }
    if (!dismissed) banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    // Stop the browser's own default mini-banner so we can show our own
    // plain-language one in the same visual style as the rest of the site.
    event.preventDefault();
    deferredPrompt = event;
    showBanner();
  });

  installBtn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () {
      deferredPrompt = null;
      hideBanner();
    });
  });

  if (dismissBtn) {
    dismissBtn.addEventListener("click", function () {
      try {
        sessionStorage.setItem("bbtlInstallBannerDismissed", "1");
      } catch (e) {
        // ignore -- worst case the banner reappears on the next page load
      }
      hideBanner();
    });
  }

  // If the visitor completes the install, make sure the banner is gone
  // (covers the case where the browser's own mini-banner or menu was used
  // instead of our button).
  window.addEventListener("appinstalled", function () {
    hideBanner();
    deferredPrompt = null;
  });

  // ---------- iPhone Safari: no auto-install signal exists, so instead
  // show a plain-language walkthrough automatically when we detect an
  // iPhone visitor who hasn't already added the site to their home screen.
  // Scoped to iPhone/iPod (not iPad) because the Share icon lives in a
  // different spot on iPad's Safari toolbar, which would make step 1 wrong.
  var iosBanner = document.getElementById("ios-install-banner");
  var iosDismissBtn = document.getElementById("ios-install-banner-dismiss");

  function isIphoneSafari() {
    return /iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isAlreadyInstalled() {
    return "standalone" in window.navigator && window.navigator.standalone === true;
  }

  if (iosBanner && isIphoneSafari() && !isAlreadyInstalled()) {
    var iosDismissed = false;
    try {
      iosDismissed = sessionStorage.getItem("bbtlIosBannerDismissed") === "1";
    } catch (e) {
      // sessionStorage unavailable -- just show it
    }
    if (!iosDismissed) iosBanner.hidden = false;
  }

  if (iosDismissBtn) {
    iosDismissBtn.addEventListener("click", function () {
      try {
        sessionStorage.setItem("bbtlIosBannerDismissed", "1");
      } catch (e) {
        // ignore -- worst case the banner reappears on the next page load
      }
      iosBanner.hidden = true;
    });
  }
})();
