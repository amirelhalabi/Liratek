// "One shop, every screen" — the scroll story under the hero.
//
// On a desktop-width screen with motion allowed, the section pins and a GSAP
// timeline (scrubbed to the scroll) moves through the five devices: Windows
// laptop → Mac → browser → iPhone → Android. Everywhere else (phones, reduce
// motion, GSAP failed to load) the page keeps the plain stacked version, so
// nothing is ever hidden behind the animation.

(function () {
  "use strict";

  if (!window.gsap || !window.ScrollTrigger) return;
  var gsap = window.gsap;
  gsap.registerPlugin(window.ScrollTrigger);

  // The page uses CSS smooth scrolling for its anchor links. ScrollTrigger
  // measures by jumping the scroll position during a refresh (which runs on
  // resize and when the tab becomes visible again); with CSS smooth
  // scrolling that jump animates, every position is measured wrong and the
  // pinned section ends up overlapping the rest of the page. So while the
  // story is active, CSS smooth scrolling is off (html.ew-ready, see
  // everywhere.css) and in-page links scroll smoothly from here instead.
  document.addEventListener("click", function (e) {
    if (!document.documentElement.classList.contains("ew-ready")) return;
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute("href").length < 2) return;
    var el = document.getElementById(a.getAttribute("href").slice(1));
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", a.getAttribute("href"));
  });

  var mm = gsap.matchMedia();

  mm.add(
    "(min-width: 761px) and (prefers-reduced-motion: no-preference)",
    function () {
      document.documentElement.classList.add("ew-ready");

      var caps = gsap.utils.toArray(".ew-cap");
      var dots = gsap.utils.toArray(".ew-rail span");

      // Split each caption title into words so they can pop in one by one.
      caps.forEach(function (c) {
        var h = c.querySelector("h3");
        if (h.dataset.split) return;
        h.innerHTML = h.textContent
          .trim()
          .split(/\s+/)
          .map(function (w) {
            return '<span class="w">' + w + "</span>";
          })
          .join(" ");
        h.dataset.split = "1";
      });

      gsap.set(".ew-dev", {
        transformPerspective: 1800,
        transformOrigin: "50% 50%",
      });
      // Start flat and centred, zoomed into the Windows screen (its centre sits
      // at 50% / 44% of the laptop image), then pull straight back.
      gsap.set("#ew-win", { opacity: 1 });
      gsap.set("#ew-mac", {
        opacity: 0,
        xPercent: 70,
        rotateY: -38,
        scale: 0.8,
      });
      gsap.set("#ew-web", { opacity: 0, scale: 0.55, rotateX: 24, y: 60 });
      gsap.set("#ew-ios", {
        opacity: 0,
        yPercent: 90,
        rotateZ: -14,
        rotateY: 25,
        scale: 0.85,
      });
      gsap.set("#ew-and", {
        opacity: 0,
        xPercent: 160,
        rotateZ: 16,
        rotateY: -30,
        scale: 0.85,
      });
      gsap.set(caps, { opacity: 0 });
      // The progress dots sit over the zoomed-in laptop at first; show them once it has pulled back.
      gsap.set(".ew-rail", { opacity: 0 });

      function setDot(i) {
        dots.forEach(function (d, k) {
          d.classList.toggle("on", k === i);
        });
      }

      // Entry: as the section scrolls up into view, the stage pulls back from
      // 1.3x (zoomed into the Windows screen) to full size, finishing exactly
      // when the section pins below the top bar.
      gsap.fromTo(
        ".ew-stage",
        { scale: 1.3, transformOrigin: "50% 44%" },
        {
          scale: 1,
          ease: "none",
          scrollTrigger: {
            trigger: ".ew-pin",
            start: "top bottom",
            end: function () {
              var bar = document.querySelector(".topbar");
              return "top " + (bar ? bar.offsetHeight : 0) + "px";
            },
            scrub: 0.6,
            // Created before the pinned timeline (it sits above it on the page),
            // so refreshes run top to bottom; the other order broke the pin
            // after switching tabs and back.
            refreshPriority: 1,
          },
        },
      );

      var tl = gsap.timeline({
        defaults: { ease: "power3.inOut", duration: 1 },
        scrollTrigger: {
          trigger: ".ew-pin",
          // Pin just below the sticky top bar so it never covers the stage.
          start: function () {
            var bar = document.querySelector(".topbar");
            return "top " + (bar ? bar.offsetHeight : 0) + "px";
          },
          end: "+=650%",
          scrub: 0.8,
          pin: true,
          anticipatePin: 1,
          onUpdate: function (self) {
            setDot(Math.min(4, Math.floor(self.progress * 5.2)));
          },
        },
      });

      function capIn(i, at) {
        tl.set(caps[i], { opacity: 1 }, at);
        tl.fromTo(
          caps[i].querySelectorAll(".w"),
          { opacity: 0, y: 40, rotateX: -60 },
          {
            opacity: 1,
            y: 0,
            rotateX: 0,
            stagger: 0.08,
            duration: 0.6,
            ease: "back.out(1.7)",
          },
          at,
        );
        tl.fromTo(
          caps[i].querySelectorAll(".step, p"),
          { opacity: 0, y: 16 },
          { opacity: 1, y: 0, duration: 0.5 },
          at + 0.15,
        );
      }
      function capOut(i, at) {
        tl.to(caps[i], { opacity: 0, y: -30, scale: 0.96, duration: 0.45 }, at);
      }
      // The page only uses a faint Signal Blue tint, so the glow drifts and
      // breathes with each device instead of changing colour.
      var drift = [
        [-60, -30, 1.05],
        [70, 20, 0.95],
        [-40, 50, 1.1],
        [50, -40, 1],
      ];
      var gi = 0;
      function glow(at) {
        var d = drift[gi++ % drift.length];
        tl.to(
          ".ew-glow .g1",
          { x: d[0], y: d[1], scale: d[2], duration: 1.2 },
          at,
        );
        tl.to(
          ".ew-glow .g2",
          { x: -d[0], y: -d[1], scale: 2 - d[2], duration: 1.2 },
          at,
        );
      }

      // 1 · Windows: the zoom-out happens while the section scrolls INTO view
      // (separate tween below), so the laptop arrives at full size when the
      // section pins; here the caption pops in and the laptop rests.
      capIn(0, 0.2);
      tl.to(".ew-rail", { opacity: 1, duration: 0.4 }, 0.3);
      tl.to({}, { duration: 1.2 }, 0.5);

      // 2 · Windows swings out to the left, the MacBook swings in.
      tl.to(
        "#ew-win",
        { xPercent: -80, rotateY: 40, scale: 0.75, opacity: 0, duration: 1.1 },
        1.7,
      );
      tl.to(
        "#ew-mac",
        { xPercent: 0, rotateY: 0, scale: 1, opacity: 1, duration: 1.1 },
        1.8,
      );
      capOut(0, 1.7);
      capIn(1, 2.15);
      glow(1.7);
      tl.to(
        "#ew-mac",
        { rotateY: -6, rotateX: 4, duration: 0.6, ease: "sine.inOut" },
        2.9,
      );

      // 3 · Zoom through the MacBook screen into the browser.
      tl.to(
        "#ew-mac",
        {
          scale: 2.6,
          opacity: 0,
          rotateY: 0,
          rotateX: 0,
          duration: 1.1,
          ease: "power2.in",
        },
        3.6,
      );
      tl.to(
        "#ew-web",
        {
          scale: 1,
          rotateX: 0,
          y: 0,
          opacity: 1,
          duration: 1,
          ease: "power3.out",
        },
        4.15,
      );
      capOut(1, 3.6);
      capIn(2, 4.25);
      glow(3.6);
      tl.to(
        "#ew-web",
        { rotateY: 8, rotateX: -4, duration: 0.6, ease: "sine.inOut" },
        5.1,
      );

      // 4 · The browser tips back, the iPhone spins up in front.
      tl.to(
        "#ew-web",
        {
          scale: 0.6,
          rotateX: 55,
          rotateY: 0,
          y: -140,
          opacity: 0.25,
          duration: 1.1,
        },
        5.8,
      );
      tl.to(
        "#ew-ios",
        {
          yPercent: 0,
          rotateZ: 0,
          rotateY: 0,
          scale: 1.08,
          opacity: 1,
          duration: 1.1,
          ease: "back.out(1.4)",
        },
        5.95,
      );
      capOut(2, 5.8);
      capIn(3, 6.3);
      glow(5.8);

      // 5 · The iPhone leans left, the Pixel flies in; both settle tilted.
      tl.to("#ew-web", { opacity: 0, duration: 0.6 }, 7.3);
      tl.to(
        "#ew-ios",
        { xPercent: -62, rotateZ: -7, rotateY: 14, scale: 1, duration: 1 },
        7.3,
      );
      tl.to(
        "#ew-and",
        {
          xPercent: 62,
          rotateZ: 7,
          rotateY: -14,
          scale: 1,
          opacity: 1,
          duration: 1.1,
          ease: "back.out(1.3)",
        },
        7.4,
      );
      capOut(3, 7.3);
      capIn(4, 7.75);
      glow(7.3);
      tl.to(
        ["#ew-ios", "#ew-and"],
        { y: -14, duration: 0.6, ease: "sine.inOut", stagger: 0.1 },
        8.5,
      );
      tl.to({}, { duration: 0.6 });

      return function () {
        document.documentElement.classList.remove("ew-ready");
      };
    },
  );
})();
