/* =========================================================================
   SITS SÉNÉGAL — Page Statistiques
   Rôle : consommation AJAX des données territoriales + infrastructures,
   agrégation côté client, et restitution en chiffres clés / graphique /
   tableau. Fichier autonome (n'a besoin ni de app.js ni de territoire.js).

   -------------------------------------------------------------------------
   Sources de données
   -------------------------------------------------------------------------
   - data/territoire_stats.json : agrégats précalculés (régions,
     départements, communautés rurales, superficies) à partir de
     regions.geojson / departements.geojson / communes_rurales.geojson.
     On évite de refaire ce calcul dans le navigateur : ces 3 fichiers
     contiennent des géométries de polygones (jusqu'à ~10 Mo à eux seuls)
     qui n'apportent rien à une page de statistiques. Le script utilisé
     pour générer ce fichier est indiqué dans son champ "generated_from".
   - data/<type>.geojson (centre_sante, forage, hotelerie, loisirs, lycee,
     marche, parking) : chargés tels quels via fetch (vraie consommation
     AJAX), pour la répartition par type et par région.

   Les codes de région utilisés dans les fichiers d'infrastructures ne
   correspondent PAS à ceux de regions.geojson (deux référentiels
   différents dans les données fournies) : la jointure région se fait
   donc par nom normalisé (majuscules, sans accents, tirets -> espaces).
   ========================================================================= */

const STATS_CONFIG = {
  TERRITOIRE_STATS_PATH: "data/territoire_stats.json",
  INFRA_SOURCES: [
    { key: "centre_sante", label: "Centre de santé", path: "data/centre_sante.geojson" },
    { key: "forage", label: "Forage", path: "data/forage.geojson" },
    { key: "hotelerie", label: "Hôtellerie", path: "data/hotelerie.geojson" },
    { key: "loisirs", label: "Loisirs", path: "data/loisirs.geojson" },
    { key: "lycee", label: "Lycée public", path: "data/lycee.geojson" },
    { key: "marche", label: "Marché", path: "data/marche.geojson" },
    { key: "parking", label: "Parking", path: "data/parking.geojson" },
  ],
};

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les accents
    .toUpperCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Échec du chargement (${response.status}) : ${url}`);
  }
  return response.json();
}

function formatNumber(value) {
  return Number(value).toLocaleString("fr-FR");
}
function formatSuperficieKm2(value) {
  return `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} km²`;
}

// -------------------------------------------------------------------------
// 1. Chargement des données
// -------------------------------------------------------------------------
async function loadTerritoireStats() {
  return fetchJSON(STATS_CONFIG.TERRITOIRE_STATS_PATH);
}

// Charge un fichier d'infrastructures et retourne son décompte total ainsi
// que sa répartition par région (nom normalisé -> nombre).
async function loadInfraSource(source) {
  const geojson = await fetchJSON(source.path);
  const byRegionNorm = {};
  geojson.features.forEach((feature) => {
    const regionNom = feature.properties && feature.properties.region && feature.properties.region.nom;
    const key = normalizeName(regionNom || "Non renseigné");
    byRegionNorm[key] = (byRegionNorm[key] || 0) + 1;
  });
  return {
    key: source.key,
    label: source.label,
    count: geojson.features.length,
    byRegionNorm,
  };
}

// -------------------------------------------------------------------------
// 2. Chiffres clés
// -------------------------------------------------------------------------
function renderKeyStats(territoire, totalInfra) {
  const container = document.getElementById("key-stats");
  const stats = [
    { num: territoire.totaux.nb_regions, label: "Régions" },
    { num: territoire.totaux.nb_departements, label: "Départements" },
    { num: territoire.totaux.nb_communes_rurales, label: "Communautés rurales" },
    { num: formatSuperficieKm2(territoire.totaux.superficie_totale_km2), label: "Superficie totale" },
    { num: formatNumber(totalInfra), label: "Infrastructures recensées" },
  ];

  container.innerHTML = "";
  stats.forEach(({ num, label }) => {
    const card = document.createElement("div");
    card.className = "stat glass reveal";
    card.dataset.group = "key-stats";
    card.innerHTML = `<div class="num">${typeof num === "number" ? formatNumber(num) : num}</div><div class="label">${label}</div>`;
    container.appendChild(card);
  });
}

// -------------------------------------------------------------------------
// 3. Répartition des infrastructures par type
// -------------------------------------------------------------------------
function renderInfraBreakdown(infraSources, totalInfra) {
  const list = document.getElementById("infra-breakdown-list");
  const sorted = [...infraSources].sort((a, b) => b.count - a.count);

  list.innerHTML = "";
  sorted.forEach(({ label, count }) => {
    const pct = totalInfra ? (count / totalInfra) * 100 : 0;
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <span>${label}</span>
      <span class="bar-track"><span class="bar-fill" style="width: ${pct.toFixed(1)}%"></span></span>
      <span class="count">${formatNumber(count)}</span>
    `;
    list.appendChild(row);
  });

  // Déclenche l'animation des barres (le conteneur .breakdown-card porte
  // déjà .reveal ; on ajoute in-view directement puisque le contenu vient
  // d'être injecté après le chargement des données, pas au défilement).
  requestAnimationFrame(() => {
    document.getElementById("infra-breakdown").classList.add("in-view");
  });
}

// -------------------------------------------------------------------------
// 4. Graphique "Infrastructures par région" (Chart.js), filtrable par type
// -------------------------------------------------------------------------
function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildRegionCounts(territoireRegions, infraSources, typeKey) {
  const sources = typeKey ? infraSources.filter((s) => s.key === typeKey) : infraSources;
  return territoireRegions.map((region) => {
    const norm = normalizeName(region.nom);
    const total = sources.reduce((sum, s) => sum + (s.byRegionNorm[norm] || 0), 0);
    return { nom: region.nom, total };
  }).sort((a, b) => b.total - a.total);
}

let regionChart = null;

function renderInfraRegionChart(territoireRegions, infraSources) {
  const select = document.getElementById("infra-type-filter");
  infraSources.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.key;
    option.textContent = source.label;
    select.appendChild(option);
  });

  function draw() {
    const rows = buildRegionCounts(territoireRegions, infraSources, select.value);
    const accent = getCSSVar("--teal") || "#14b8a6";
    const gridColor = getCSSVar("--panel-line") || "#223049";
    const textColor = getCSSVar("--text-dim") || "#93a4bd";

    const data = {
      labels: rows.map((r) => r.nom),
      datasets: [{
        label: "Infrastructures",
        data: rows.map((r) => r.total),
        backgroundColor: accent,
        borderRadius: 4,
        maxBarThickness: 22,
      }],
    };

    if (regionChart) {
      regionChart.data = data;
      regionChart.options.scales.x.grid.color = gridColor;
      regionChart.options.scales.x.ticks.color = textColor;
      regionChart.options.scales.y.ticks.color = textColor;
      regionChart.update();
      return;
    }

    const ctx = document.getElementById("infra-region-chart").getContext("2d");
    regionChart = new Chart(ctx, {
      type: "bar",
      data,
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: textColor, precision: 0 },
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor },
          },
        },
      },
    });
  }

  select.addEventListener("change", draw);
  draw();

  // Le graphique est dessiné avec les couleurs du thème actif ; si
  // l'utilisateur bascule clair/sombre pendant la consultation, on
  // régénère les couleurs sans recharger les données.
  const observer = new MutationObserver(draw);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

// -------------------------------------------------------------------------
// 5. Tableau "Le territoire par région"
// -------------------------------------------------------------------------
function renderRegionTable(territoireRegions) {
  const tbody = document.getElementById("region-table-body");
  tbody.innerHTML = "";
  territoireRegions.forEach((region) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${region.nom}</td>
      <td class="num">${formatSuperficieKm2(region.superficie_km2)}</td>
      <td class="num">${formatNumber(region.nb_departements)}</td>
      <td class="num">${formatNumber(region.nb_communes_rurales)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------------------
// 6. Animation d'apparition au défilement (mêmes réglages que accueil.js,
//    dupliqués ici pour que cette page reste autonome)
// -------------------------------------------------------------------------
function initReveal() {
  const items = document.querySelectorAll(".reveal");
  const groups = {};
  items.forEach((el) => {
    const group = el.dataset.group || "default";
    groups[group] = groups[group] || [];
    groups[group].push(el);
  });
  Object.values(groups).forEach((els) => {
    els.forEach((el, i) => { el.style.transitionDelay = `${i * 90}ms`; });
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
}

// -------------------------------------------------------------------------
// 7. Démarrage
// -------------------------------------------------------------------------
async function start() {
  initReveal();
  try {
    const [territoire, ...infraSources] = await Promise.all([
      loadTerritoireStats(),
      ...STATS_CONFIG.INFRA_SOURCES.map(loadInfraSource),
    ]);

    const totalInfra = infraSources.reduce((sum, s) => sum + s.count, 0);

    renderKeyStats(territoire, totalInfra);
    renderInfraBreakdown(infraSources, totalInfra);
    renderInfraRegionChart(territoire.regions, infraSources);
    renderRegionTable(territoire.regions);

    // Les cartes de chiffres clés sont injectées après coup : on relance
    // l'observateur pour qu'elles bénéficient aussi de l'animation.
    initReveal();
  } catch (err) {
    console.error("Erreur de chargement des statistiques :", err);
    document.getElementById("key-stats").innerHTML =
      '<p class="placeholder">Erreur de chargement des données. Vérifie que les fichiers GeoJSON et data/territoire_stats.json existent dans le dossier data/.</p>';
  }
}

document.addEventListener("DOMContentLoaded", start);