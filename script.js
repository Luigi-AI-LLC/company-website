/*
 * Luigi AI — page behaviour (navigation, scroll effects, small touches)
 * The booking flow lives in scheduler.js.
 */
(function () {
    'use strict';

    document.documentElement.classList.add('js');

    var header = document.querySelector('.site-header');
    var toggle = document.querySelector('.nav-toggle');
    var mobileNav = document.getElementById('mobileNav');

    /* ---- Mobile menu ---------------------------------------------------- */
    function setMenu(open) {
        if (!toggle || !mobileNav) return;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        mobileNav.hidden = !open;
    }

    if (toggle && mobileNav) {
        toggle.addEventListener('click', function () {
            setMenu(toggle.getAttribute('aria-expanded') !== 'true');
        });
        mobileNav.addEventListener('click', function (e) {
            if (e.target.closest('a')) setMenu(false);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
                setMenu(false);
                toggle.focus();
            }
        });
        document.addEventListener('click', function (e) {
            if (toggle.getAttribute('aria-expanded') === 'true' && !header.contains(e.target)) setMenu(false);
        });
        window.matchMedia('(min-width: 769px)').addEventListener('change', function (mq) {
            if (mq.matches) setMenu(false);
        });
    }

    /* ---- Header shadow on scroll --------------------------------------- */
    function onScroll() {
        if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---- Scroll-spy for desktop nav ------------------------------------ */
    var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-desktop a[href^="#"]'));
    var sections = navLinks
        .map(function (a) { return document.querySelector(a.getAttribute('href')); })
        .filter(Boolean);

    if ('IntersectionObserver' in window && sections.length) {
        var current = null;
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) current = entry.target.id;
            });
            navLinks.forEach(function (a) {
                a.classList.toggle('is-active', a.getAttribute('href') === '#' + current);
            });
        }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
        sections.forEach(function (s) { spy.observe(s); });
    }

    /* ---- Reveal on scroll ---------------------------------------------- */
    var revealEls = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || !('IntersectionObserver' in window)) {
        revealEls.forEach(function (n) { n.classList.add('is-visible'); });
    } else {
        var revealer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry, i) {
                if (!entry.isIntersecting) return;
                var n = entry.target;
                var siblings = Array.prototype.slice.call(n.parentElement.querySelectorAll('[data-reveal]'));
                var idx = siblings.indexOf(n);
                n.style.transitionDelay = (Math.max(0, idx) * 70) + 'ms';
                n.classList.add('is-visible');
                revealer.unobserve(n);
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
        revealEls.forEach(function (n) { revealer.observe(n); });
    }

    /* ---- Footer year --------------------------------------------------- */
    Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (n) {
        n.textContent = String(new Date().getFullYear());
    });
})();
