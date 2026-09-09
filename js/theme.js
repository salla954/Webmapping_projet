/* =========================================================================
   SITS SÉNÉGAL — Bascule de thème clair / sombre
   Partagé par toutes les pages (Accueil / Carte / Statistiques).

   Le thème est déjà posé très tôt par un petit script inline dans le
   <head> de chaque page (avant le chargement du CSS), pour éviter un
   flash du mauvais thème à l'affichage. Ce fichier-ci ne s'occupe que
   du clic sur le bouton et de la sauvegarde du choix dans localStorage,
   afin que le thème choisi soit le même en changeant de page.
   ========================================================================= */
(function () {
  const STORAGE_KEY = "sits-theme";

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("theme-toggle-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", String(theme === "light"));
      btn.title = theme === "light" ? "Passer au thème sombre" : "Passer au thème clair";
    }
  }

  function initThemeToggle() {
    // Applique le libellé/aria cohérent avec le thème déjà posé par le
    // script inline du <head> (on ne le change pas ici, juste l'UI du bouton).
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current);

    const btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });
  }

  document.addEventListener("DOMContentLoaded", initThemeToggle);
})();