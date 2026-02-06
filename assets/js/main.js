(() => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.getElementById("nav-links");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    navLinks.addEventListener("click", (e) => {
      const target = e.target;
      if (target instanceof HTMLAnchorElement) {
        navLinks.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Active section highlighting in nav
  const links = Array.from(document.querySelectorAll(".nav-link")).filter((a) =>
    a.getAttribute("href")?.startsWith("#"),
  );
  const targets = links
    .map((a) => {
      const id = a.getAttribute("href")?.slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window && links.length && targets.length) {
    const byId = new Map(links.map((a) => [a.getAttribute("href")?.slice(1), a]));
    const obs = new IntersectionObserver(
      (entries) => {
        // Find the top-most visible section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top ?? 0) - (b.boundingClientRect.top ?? 0))[0];

        if (!visible?.target?.id) return;
        links.forEach((a) => a.classList.remove("is-active"));
        const active = byId.get(visible.target.id);
        if (active) active.classList.add("is-active");
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.1, 0.2, 0.3] },
    );

    targets.forEach((el) => obs.observe(el));
  }
})();
