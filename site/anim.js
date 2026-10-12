"use strict";

// Animasi landing Bundacare memakai GSAP + ScrollTrigger (self-host di site/vendor/gsap).
//
// Prinsip:
// - Progresif: kalau GSAP gagal dimuat, kelas "js-anim" dihapus supaya semua konten
//   tetap tampil (tidak ada yang tersembunyi permanen).
// - Menghormati prefers-reduced-motion: kelas "js-anim" tidak pernah dipasang, jadi
//   animasi tidak dijalankan sama sekali.
// - Hanya properti transform/opacity yang dianimasikan, supaya tetap lancar di HP
//   kelas menengah dan tidak menambah beban layout.
(function () {
  var root = document.documentElement;
  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Kalau GSAP tidak ada, jangan biarkan konten tersembunyi oleh .js-anim.
  if (!window.gsap || reduce) {
    root.classList.remove("js-anim");
    return;
  }

  var gsap = window.gsap;
  var hasST = !!window.ScrollTrigger;
  if (hasST) gsap.registerPlugin(window.ScrollTrigger);
  gsap.defaults({ ease: "power3.out" });

  try {
    var animEls = gsap.utils.toArray("[data-anim]");
    var stickers = gsap.utils.toArray(".hero-sticker");

    // 1. Hero masuk bertahap: judul -> paragraf -> tombol -> kartu.
    var heroEls = animEls.filter(function (el) {
      return el.closest(".hero") && !el.classList.contains("hero-sticker");
    });
    var heroTl = gsap.timeline();
    heroEls.forEach(function (el, i) {
      heroTl.fromTo(
        el,
        { opacity: 0, y: 32 },
        { opacity: 1, y: 0, duration: 0.85, clearProps: "transform" },
        i * 0.14,
      );
    });

    // 2. Stiker emoji: muncul dengan pegas, lalu mengapung pelan.
    if (stickers.length) {
      heroTl.fromTo(
        stickers,
        { opacity: 0, scale: 0 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.6,
          ease: "back.out(2.2)",
          stagger: 0.12,
        },
        "-=0.6",
      );
    }

    var startFloats = function () {
      stickers.forEach(function (el, i) {
        gsap.to(el, {
          y: i % 2 ? 14 : -16,
          rotation: i % 2 ? 9 : -9,
          duration: 2.8 + i * 0.5,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          delay: i * 0.25,
        });
      });
    };
    if (heroTl.duration() > 0) heroTl.eventCallback("onComplete", startFloats);
    else startFloats();

    // 3. Parallax halus saat hero di-scroll.
    if (hasST) {
      gsap.to(".hero-card", {
        yPercent: -7,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
      gsap.to(".hero-stickers", {
        yPercent: -16,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }

    // 4. Bagian lain muncul saat masuk viewport (fade-up), sekali saja.
    var scrollEls = animEls.filter(function (el) {
      return !el.closest(".hero");
    });
    scrollEls.forEach(function (el) {
      var tween = {
        opacity: 1,
        y: 0,
        duration: 0.7,
        // Bersihkan transform setelah selesai supaya efek hover CSS (mis. kartu
        // artikel terangkat) tetap bekerja.
        clearProps: "transform",
      };
      if (hasST) {
        tween.scrollTrigger = { trigger: el, start: "top 88%", once: true };
      }
      gsap.fromTo(el, { opacity: 0, y: 26 }, tween);
    });

    // Hitung ulang posisi pemicu setelah font/gambar selesai dimuat.
    if (hasST) {
      window.addEventListener("load", function () {
        window.ScrollTrigger.refresh();
      });
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
          window.ScrollTrigger.refresh();
        });
      }
    }
  } catch (err) {
    // Apa pun yang gagal: pastikan konten tidak tertinggal tersembunyi.
    root.classList.remove("js-anim");
    if (window.console && console.warn) {
      console.warn("Animasi landing dilewati:", err);
    }
  }
})();
