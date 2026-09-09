/* Révèle les éléments .reveal quand ils entrent dans le viewport, avec un
   décalage progressif entre les éléments d'un même groupe (data-group). */
document.addEventListener("DOMContentLoaded", () => {
  const items = document.querySelectorAll(".reveal");

  const groups = {};
  items.forEach((el) => {
    const group = el.dataset.group || "default";
    groups[group] = groups[group] || [];
    groups[group].push(el);
  });
  Object.values(groups).forEach((els) => {
    els.forEach((el, i) => {
      el.style.transitionDelay = `${i * 90}ms`;
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  items.forEach((el) => observer.observe(el));
});
