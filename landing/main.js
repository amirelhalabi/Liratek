// LiraTek landing page — the "go to my shop" box, the demo video's sound
// button, and the few strings that JavaScript writes at run time.
//
// Each language is its own static page: English at / (index.html) and Arabic
// at /ar (ar.html), so search engines and link previews see both. The page's
// own <html lang> decides which strings below are used.

(function () {
  "use strict";

  var BASE_DOMAIN = "liratek.shop";

  // Before this page existed, liratek.shop redirected to www, so old links
  // and bookmarks may carry an app route (liratek.shop/#/login). Send those
  // on to the app instead of showing the landing page.
  if (location.hash.indexOf("#/") === 0) {
    location.replace("https://www." + BASE_DOMAIN + "/" + location.hash);
    return;
  }

  var lang = document.documentElement.lang === "ar" ? "ar" : "en";

  // Old shared links to the Arabic version were /?lang=ar (one page, switched
  // by script). Arabic has its own address now. Only an explicit ?lang=ar is
  // redirected — never a browser setting or a stored choice, so / always
  // stays reachable as the default page.
  if (
    lang === "en" &&
    new URLSearchParams(location.search).get("lang") === "ar"
  ) {
    location.replace("/ar" + location.hash);
    return;
  }

  var STRINGS = {
    en: {
      "msg.invalid": "Use English letters, numbers and dashes only.",
      "msg.notfound":
        "We couldn't find a shop with that name. Check the spelling.",
      "msg.checking": "Checking…",
      "video.soundOn": "Turn sound on",
      "video.soundOff": "Turn sound off",
    },
    ar: {
      "msg.invalid": "استعمل أحرفاً إنكليزية وأرقاماً وشرطة (-) فقط.",
      "msg.notfound": "لم نجد محلاً بهذا الاسم. تأكد من الاسم.",
      "msg.checking": "جارٍ التحقق…",
      "video.soundOn": "تشغيل الصوت",
      "video.soundOff": "كتم الصوت",
    },
  };

  function t(key) {
    return STRINGS[lang][key];
  }

  // ---- "Go to my shop" ----------------------------------------------------

  var msg = document.getElementById("shop-msg");

  function setMessage(text, isError) {
    msg.textContent = text;
    msg.classList.toggle("error", Boolean(isError));
  }

  // Hostname safety only — NOT LiraTek's slug rules (those live in
  // packages/core/src/utils/tenantSlug.ts and the server enforces them).
  // Without this, input like "evil.com/x?" would build a URL on another site.
  function cleanName(raw) {
    var name = raw.trim().toLowerCase();
    name = name.replace(/^https?:\/\//, "");
    var suffix = "." + BASE_DOMAIN;
    var slash = name.indexOf("/");
    if (slash !== -1) name = name.slice(0, slash);
    if (name.slice(-suffix.length) === suffix)
      name = name.slice(0, -suffix.length);
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? name : null;
  }

  // Shop addresses have no wildcard DNS, so a wrong name would end on the
  // browser's own "site can't be reached" page. Probe first: a no-cors fetch
  // of the shop's favicon resolves for a real shop and rejects when the host
  // does not exist. On a slow network, give up waiting and go anyway.
  function probe(name) {
    var url = "https://" + name + "." + BASE_DOMAIN + "/favicon.png";
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        resolve("timeout");
      }, 6000);
    });
    var check = fetch(url, { mode: "no-cors", cache: "no-store" }).then(
      function () {
        return "ok";
      },
      function () {
        return "missing";
      },
    );
    return Promise.race([check, timeout]);
  }

  document
    .getElementById("shop-form")
    .addEventListener("submit", function (event) {
      event.preventDefault();
      var input = document.getElementById("shop-name");
      var button = document.getElementById("shop-go");
      var name = cleanName(input.value);
      if (!name) {
        setMessage(t("msg.invalid"), true);
        input.focus();
        return;
      }
      button.disabled = true;
      setMessage(t("msg.checking"), false);
      probe(name).then(function (result) {
        button.disabled = false;
        if (result === "missing") {
          setMessage(t("msg.notfound"), true);
          input.focus();
          return;
        }
        setMessage("", false);
        location.href = "https://" + name + "." + BASE_DOMAIN + "/#/login";
      });
    });

  // ---- startup --------------------------------------------------------------

  document.getElementById("year").textContent = String(
    new Date().getFullYear(),
  );

  var video = document.getElementById("demo-video");

  // Browsers only autoplay muted video; the button turns the music on.
  var soundToggle = document.getElementById("sound-toggle");
  // Icon button: the label lives in aria-label/title, in the current language.
  function syncSoundLabel() {
    var on = !video.muted;
    var label = t(on ? "video.soundOff" : "video.soundOn");
    soundToggle.setAttribute("aria-pressed", String(on));
    soundToggle.setAttribute("aria-label", label);
    soundToggle.setAttribute("title", label);
  }
  syncSoundLabel();
  soundToggle.addEventListener("click", function () {
    video.muted = !video.muted;
    if (!video.muted) {
      video.currentTime = 0;
      video.play();
    }
    syncSoundLabel();
  });

  // Respect "reduce motion": keep the poster, don't autoplay.
  if (video && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.removeAttribute("autoplay");
    video.pause();
  }
})();
