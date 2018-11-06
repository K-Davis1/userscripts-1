// ==UserScript==
// @name        Hide ads
// @namespace   https://github.com/Charcoal-SE/
// @author      Glorfindel
// @contributor K-Davis1
// @description Hides advertisements so that the flag link doesn't jump while loading the page
// @see-also    https://meta.stackexchange.com/a/289896/285368
// @match       *://*.stackexchange.com/*
// @match       *://*.stackoverflow.com/*
// @match       *://*.superuser.com/*
// @match       *://*.serverfault.com/*
// @match       *://*.askubuntu.com/*
// @match       *://*.stackapps.com/*
// @match       *://*.mathoverflow.net/*
// @exclude     *://chat.stackexchange.com/*
// @exclude     *://chat.meta.stackexchange.com/*
// @exclude     *://chat.stackoverflow.com/*
// @exclude     *://blog.stackoverflow.com/*
// @exclude     *://*.area51.stackexchange.com/*
// @version     1.1
// @grant       none
// ==/UserScript==

console.log("Hide ads");
var link = window.document.createElement("link");
link.rel = "stylesheet";
link.type = "text/css";
link.href = "data:text/css," +
            // Selectors start here
            ".adzerk-vote { display: none; }";
document.getElementsByTagName("HEAD")[0].appendChild(link);

//Remove the APOSE ad that can shift other elements downwards once it loads
var adAspose = document.getElementById('dfp-tag');
if (adAspose) {
    adAspose.parentNode.removeChild(adAspose);
}
