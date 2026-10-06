// LiraTek landing page — language toggle and the "go to my shop" box.
// English is the page's own HTML (what crawlers and link previews see);
// Arabic is applied on top by swapping text from the table below.

(function () {
  "use strict";

  var BASE_DOMAIN = "liratek.shop";
  var WHATSAPP = "96181077357";
  var STORAGE_KEY = "liratek.landing.lang";

  // DRAFT Arabic copy — to be reviewed by the owner before launch.
  var AR = {
    "page.title": "LiraTek — نظام بيع لمحلات الهواتف في لبنان",
    "nav.login": "دخول المحل",
    "hero.eyebrow": "مصمّم لمحلات الهواتف في لبنان",
    "hero.title": "محلك كله، بالدولار والليرة، في مكان واحد.",
    "hero.lead":
      "بِع، تابع المخزون، أرسل واستلم تحويلات OMT وWhish، اشحن MTC وAlfa، تابع ديون الزبائن وأقفل اليوم — كل مبلغ بالدولار والليرة، وكل صندوق مضبوط.",
    "cta.whatsapp": "تواصل معنا على واتساب",
    "cta.features": "اكتشف الميزات",
    "cta.invite": "معك رمز دعوة؟",
    "cta.signup": "سجّل الآن",
    "features.title": "كل ما يحتاجه محل الهواتف في يومه",
    "f.pos.t": "المبيعات والمخزون",
    "f.pos.d": "بيع سريع، باركود، كميات المخزون، وتتبّع الهواتف برقم IMEI.",
    "f.cur.t": "الدولار والليرة معاً",
    "f.cur.d":
      "الأسعار والدفعات والفكّة والصناديق بالدولار والليرة. قسّم الدفعة بين العملتين، وصرّف العملات.",
    "f.omt.t": "OMT وWhish",
    "f.omt.d":
      "أرسل واستلم التحويلات مع حساب العمولة تلقائياً، وطابق رصيدك مع كشف OMT.",
    "f.rec.t": "MTC وAlfa",
    "f.rec.d": "شحن رصيد وأيام، مع تحديث ما عليك لكل مورّد.",
    "f.debt.t": "ديون الزبائن",
    "f.debt.d": "بِع بالدين، استلم الدفعات بأي عملة، واعرف ما على كل زبون.",
    "f.rep.t": "التصليحات",
    "f.rep.d":
      "أشغال التصليح من الاستلام حتى التسليم، مع القطع المستعملة وما دفعه الزبون.",
    "f.close.t": "إقفال اليوم والأرباح",
    "f.close.d":
      "أقفل كل صندوق في نهاية اليوم واطّلع على الربح من كل قسم في المحل.",
    "f.where.t": "على الكمبيوتر أو من المتصفح",
    "f.where.d":
      "استعمل تطبيق الكمبيوتر في المحل، أو ادخل من أي متصفح على عنوان محلك الخاص.",
    "login.title": "عندك محل على LiraTek؟",
    "login.lead": "اكتب اسم محلك لتنتقل إلى صفحة الدخول.",
    "login.label": "اسم المحل",
    "login.placeholder": "yourshop",
    "login.go": "ادخل إلى محلي",
    "end.title": "تريد أن تراه في محلك؟",
    "end.lead": "راسلنا لنريك كيف يعمل ونتحدث عن الأسعار.",
    "msg.invalid": "استعمل أحرفاً إنكليزية وأرقاماً وشرطة (-) فقط.",
    "msg.notfound": "لم نجد محلاً بهذا الاسم. تأكد من الاسم.",
    "msg.checking": "جارٍ التحقق…",
    "wa.text": "مرحباً، أنا مهتم بـ LiraTek لمحلي.",
  };

  var EN = {
    "page.title": document.title,
    "msg.invalid": "Use English letters, numbers and dashes only.",
    "msg.notfound":
      "We couldn't find a shop with that name. Check the spelling.",
    "msg.checking": "Checking…",
    "wa.text": "Hello, I'm interested in LiraTek for my shop.",
  };

  // Before this page existed, liratek.shop redirected to www, so old links
  // and bookmarks may carry an app route (liratek.shop/#/login). Send those
  // on to the app instead of showing the landing page.
  if (location.hash.indexOf("#/") === 0) {
    location.replace("https://www." + BASE_DOMAIN + "/" + location.hash);
    return;
  }

  var lang = "en";

  function t(key) {
    var table = lang === "ar" ? AR : EN;
    return table[key] !== undefined ? table[key] : EN[key];
  }

  // Remember each element's English text the first time we touch it, so
  // switching back needs no second copy of the English strings.
  function captureEnglish() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      EN[el.getAttribute("data-i18n")] = el.textContent.trim();
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      var parts = el.getAttribute("data-i18n-attr").split(":");
      EN[parts[1]] = el.getAttribute(parts[0]);
    });
  }

  function whatsappUrl() {
    return (
      "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(t("wa.text"))
    );
  }

  function apply(next) {
    lang = next === "ar" ? "ar" : "en";
    var root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = t("page.title");

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      var parts = el.getAttribute("data-i18n-attr").split(":");
      el.setAttribute(parts[0], t(parts[1]));
    });
    ["whatsapp-cta", "whatsapp-cta-2"].forEach(function (id) {
      var a = document.getElementById(id);
      if (a) a.href = whatsappUrl();
    });

    var toggle = document.getElementById("lang-toggle");
    toggle.textContent = lang === "ar" ? "English" : "العربية";
    toggle.lang = lang === "ar" ? "en" : "ar";

    setMessage("", false);
  }

  function savedLang() {
    var fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl === "ar" || fromUrl === "en") return fromUrl;
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "ar" || stored === "en") return stored;
    } catch (e) {
      // Storage blocked (private mode, previews) — fall through.
    }
    return (navigator.language || "").toLowerCase().indexOf("ar") === 0
      ? "ar"
      : "en";
  }

  function saveLang(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      // Not essential; the page still works.
    }
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

  captureEnglish();
  apply(savedLang());

  document.getElementById("lang-toggle").addEventListener("click", function () {
    var next = lang === "ar" ? "en" : "ar";
    saveLang(next);
    apply(next);
  });

  document.getElementById("year").textContent = String(
    new Date().getFullYear(),
  );

  // Respect "reduce motion": keep the poster, don't autoplay.
  var video = document.getElementById("demo-video");
  if (video && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.removeAttribute("autoplay");
    video.pause();
  }
})();
