/* =========================================================================
   SITS SÉNÉGAL — Module territorial (rôle : interface utilisateur /
   gestion des données territoriales)

   Ce fichier se branche SUR le module d'Awa (js/app.js) sans le modifier :
     - il réutilise CONFIG, state, getProp, zoomToLayer, highlightLayer,
       resetLayerStyle, buildPopupHTML, findLayerByFeatureKey (déjà
       déclarés globalement par app.js, chargé juste avant ce fichier) ;
     - il ajoute ses propres écouteurs sur les éléments déjà présents dans
       le DOM (#region-select, #dept-select) plutôt que de remplacer ceux
       d'app.js, pour que les deux logiques cohabitent sans conflit.

   Ce que ce fichier ajoute :
     1. Le 3e niveau de la cascade : Communauté rurale
     2. Le tableau dynamique des données territoriales (obligatoire au
        cahier des charges), avec navigation région -> département ->
        communauté rurale, cliquable pour piloter la carte
   ========================================================================= */

// -------------------------------------------------------------------------
// 0. Configuration additionnelle (on complète l'objet CONFIG d'app.js,
//    on ne le redéclare pas)
// -------------------------------------------------------------------------
CONFIG.LOCAL_COMMUNES_PATH = "data/communes_rurales.geojson";

function communesURL(deptKey) {
  if (!CONFIG.USE_API) return CONFIG.LOCAL_COMMUNES_PATH; // filtrage côté client
  const base = `${CONFIG.API_BASE_URL}/communautes-rurales`;
  return deptKey ? `${base}?departement=${encodeURIComponent(deptKey)}` : base;
}

const COMMUNE_NAME_KEYS = ["nom"];
const COMMUNE_CODE_KEYS = ["code"];
const COMMUNE_DEPT_CODE_KEYS = ["departement_code"];
const COMMUNE_DEPT_NAME_KEYS = ["departement_nom"];
const COMMUNE_REGION_NAME_KEYS = ["region_nom"];
const COMMUNE_POP_KEYS = ["population_2003"];
const COMMUNE_SUPERFICIE_KEYS = ["superficie_km2"];

// -------------------------------------------------------------------------
// 1. État additionnel (propriétés ajoutées à l'objet `state` partagé)
// -------------------------------------------------------------------------
state.allCommunesGeoJSON = null;
state.communeOutlineLayer = null; // contour de la commune sélectionnée (pas
                                   // toute la couche : 415 polygones en
                                   // permanence serait inutilement lourd)
state.tableLevel = "regions";     // "regions" | "departements" | "communes"
state.tableActiveId = null;

// -------------------------------------------------------------------------
// 2. Normalisation de texte, pour la jointure par nom quand le code est
//    absent (~10% des communautés rurales de l'agglomération dakaroise
//    n'ont pas de departement_code renseigné dans la source — vérifié en
//    amont sur les données réelles).
// -------------------------------------------------------------------------
function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les accents
    .trim()
    .toUpperCase();
}

// -------------------------------------------------------------------------
// 3. Couche Communauté rurale (chargée une fois, filtrée côté client par
//    département — code en priorité, nom en repli)
// -------------------------------------------------------------------------
async function loadCommunes(deptCode = "", deptName = "") {
  if (!state.allCommunesGeoJSON) {
    state.allCommunesGeoJSON = await fetchGeoJSON(communesURL());
  }

  if (!deptCode && !deptName) {
    return { type: "FeatureCollection", features: [] };
  }

  const normDeptName = normalizeName(deptName);

  const features = state.allCommunesGeoJSON.features.filter((f) => {
    const code = getProp(f, COMMUNE_DEPT_CODE_KEYS, null);
    if (code !== null && deptCode) {
      return String(code) === String(deptCode);
    }
    // repli par nom quand le code source est absent
    const name = getProp(f, COMMUNE_DEPT_NAME_KEYS, "");
    return normalizeName(name) === normDeptName;
  });

  return { type: "FeatureCollection", features };
}

function populateCommuneSelect(geojson) {
  const select = document.getElementById("commune-select");
  select.innerHTML = "";

  if (!geojson.features.length) {
    select.appendChild(new Option("Aucune communauté rurale (zone urbaine)", ""));
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.appendChild(new Option("— Sélectionnez une communauté rurale —", ""));
  geojson.features
    .map((f) => ({
      name: getProp(f, COMMUNE_NAME_KEYS),
      key: getProp(f, COMMUNE_CODE_KEYS, getProp(f, COMMUNE_NAME_KEYS)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ name, key }) => select.appendChild(new Option(name, key)));
}

// Dessine (ou retire) le contour de la commune sélectionnée. On ne charge
// pas les 415 polygones en permanence sur la carte : un seul à la fois.
function showCommuneOutline(feature) {
  if (state.communeOutlineLayer) {
    state.map.removeLayer(state.communeOutlineLayer);
    state.communeOutlineLayer = null;
  }
  if (!feature) return;

  state.communeOutlineLayer = L.geoJSON(feature, {
    style: { color: "#a855f7", weight: 2.5, fillColor: "#a855f7", fillOpacity: 0.18 },
  }).addTo(state.map);

  const name = getProp(feature, COMMUNE_NAME_KEYS);
  state.communeOutlineLayer.bindPopup(
    buildPopupHTML(name, [
      ["Code", getProp(feature, COMMUNE_CODE_KEYS)],
      ["Département", getProp(feature, COMMUNE_DEPT_NAME_KEYS)],
      ["Population (2003)", formatNumber(getProp(feature, COMMUNE_POP_KEYS, null))],
      ["Superficie", formatSuperficieKm2(getProp(feature, COMMUNE_SUPERFICIE_KEYS, null))],
      ["Type", "Communauté rurale"],
    ])
  );

  if (state.communeOutlineLayer.getBounds().isValid()) {
    state.map.fitBounds(state.communeOutlineLayer.getBounds(), { maxZoom: 12, padding: [20, 20] });
  }

  showInfoPanel(name, [
    ["Code", getProp(feature, COMMUNE_CODE_KEYS)],
    ["Département", getProp(feature, COMMUNE_DEPT_NAME_KEYS)],
    ["Région", getProp(feature, COMMUNE_REGION_NAME_KEYS)],
    ["Population (2003)", formatNumber(getProp(feature, COMMUNE_POP_KEYS, null))],
    ["Superficie", formatSuperficieKm2(getProp(feature, COMMUNE_SUPERFICIE_KEYS, null))],
    ["Type", "Communauté rurale"],
  ]);
}

// -------------------------------------------------------------------------
// 4. Formatage d'affichage
// -------------------------------------------------------------------------
function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "Non renseigné";
  return Number(value).toLocaleString("fr-FR");
}
function formatSuperficieKm2(value) {
  if (value === null || value === undefined || value === "") return "Non renseigné";
  return `${Number(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km²`;
}
function formatSuperficieM2ToKm2(value) {
  if (value === null || value === undefined || value === "") return "Non renseigné";
  return `${(Number(value) / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km²`;
}

// -------------------------------------------------------------------------
// 5. Tableau dynamique des données territoriales
//    Le niveau affiché suit la profondeur de sélection :
//    rien sélectionné -> régions ; région sélectionnée -> ses départements ;
//    département sélectionné -> ses communautés rurales.
// -------------------------------------------------------------------------
const TABLE_CONFIGS = {
  regions: {
    title: "Régions du Sénégal",
    columns: ["Nom", "Code", "Superficie"],
    getRow: (f) => [
      getProp(f, REGION_NAME_KEYS),
      getProp(f, REGION_CODE_KEYS),
      formatSuperficieM2ToKm2(getProp(f, ["superficie_m2"], null)),
    ],
    getKey: (f) => getProp(f, REGION_CODE_KEYS),
  },
  departements: {
    title: "Départements",
    columns: ["Nom", "Code", "Région"],
    getRow: (f) => [
      getProp(f, DEPT_NAME_KEYS),
      getProp(f, DEPT_CODE_KEYS),
      getProp(f, DEPT_REGION_LINK_KEYS),
    ],
    getKey: (f) => getProp(f, DEPT_CODE_KEYS),
  },
  communes: {
    title: "Communautés rurales",
    columns: ["Nom", "Code", "Département", "Population (2003)", "Superficie"],
    getRow: (f) => [
      getProp(f, COMMUNE_NAME_KEYS),
      getProp(f, COMMUNE_CODE_KEYS),
      getProp(f, COMMUNE_DEPT_NAME_KEYS),
      formatNumber(getProp(f, COMMUNE_POP_KEYS, null)),
      formatSuperficieKm2(getProp(f, COMMUNE_SUPERFICIE_KEYS, null)),
    ],
    getKey: (f) => getProp(f, COMMUNE_CODE_KEYS),
  },
};

function renderTable(level, features, contextLabel) {
  state.tableLevel = level;
  const config = TABLE_CONFIGS[level];

  document.getElementById("table-title").textContent = contextLabel
    ? `${config.title} — ${contextLabel}`
    : config.title;
  document.getElementById("table-subtitle").textContent =
    `${features.length} entité${features.length > 1 ? "s" : ""}`;

  const thead = document.getElementById("table-head");
  thead.innerHTML = `<tr>${config.columns.map((c) => `<th>${c}</th>`).join("")}</tr>`;

  const tbody = document.getElementById("table-body");
  const emptyMsg = document.getElementById("table-empty");
  tbody.innerHTML = "";

  if (!features.length) {
    document.getElementById("data-table").hidden = true;
    emptyMsg.hidden = false;
    return;
  }
  document.getElementById("data-table").hidden = false;
  emptyMsg.hidden = true;

  const sorted = [...features].sort((a, b) =>
    String(config.getRow(a)[0]).localeCompare(String(config.getRow(b)[0]))
  );

  sorted.forEach((feature) => {
    const key = config.getKey(feature);
    const tr = document.createElement("tr");
    if (state.tableActiveId !== null && String(key) === String(state.tableActiveId)) {
      tr.classList.add("active-row");
    }
    tr.innerHTML = config.getRow(feature).map((v) => `<td>${v ?? "—"}</td>`).join("");
    tr.addEventListener("click", () => handleTableRowClick(level, feature, key));
    tbody.appendChild(tr);
  });
}

// Un clic sur une ligne du tableau reproduit exactement la sélection via
// les listes déroulantes, pour ne pas dupliquer la logique de zoom/popup :
// on met à jour le <select> correspondant puis on déclenche son event
// "change", que ce soit celui d'app.js (région/département) ou le nôtre
// (commune).
function handleTableRowClick(level, feature, key) {
  state.tableActiveId = key;

  if (level === "regions") {
    const select = document.getElementById("region-select");
    select.value = key;
    select.dispatchEvent(new Event("change"));
  } else if (level === "departements") {
    const select = document.getElementById("dept-select");
    select.value = key;
    select.dispatchEvent(new Event("change"));
  } else if (level === "communes") {
    const select = document.getElementById("commune-select");
    select.value = key;
    select.dispatchEvent(new Event("change"));
  }
}

// -------------------------------------------------------------------------
// 6. Écouteurs additionnels — vient se greffer sur les <select> déjà
//    câblés par app.js sans remplacer ses écouteurs existants
// -------------------------------------------------------------------------
function wireTerritoireUI() {
  const regionSelect = document.getElementById("region-select");
  const deptSelect = document.getElementById("dept-select");
  const communeSelect = document.getElementById("commune-select");
  const toggleBtn = document.getElementById("toggle-table-btn");
  const closeBtn = document.getElementById("close-table-btn");
  const drawer = document.getElementById("table-drawer");

  // --- Région : réinitialise la cascade en aval + tableau ---
  regionSelect.addEventListener("change", async (e) => {
    const regionKey = e.target.value;
    state.tableActiveId = regionKey || null;
    showCommuneOutline(null);
    populateCommuneSelect({ features: [] }); // vide en attendant le choix du département

    if (!regionKey) {
      const regionsFC = await fetchGeoJSON(regionsURL());
      renderTable("regions", regionsFC.features);
      return;
    }
    // Les départements de cette région sont déjà chargés/filtrés par
    // app.js dans state.allDepartementsGeoJSON — on les réutilise plutôt
    // que de refaire une requête.
    const deptFeatures = state.allDepartementsGeoJSON.features.filter(
      (f) => String(getProp(f, DEPT_REGION_LINK_KEYS)).toLowerCase() === String(regionKey).toLowerCase()
    );
    const regionName = getProp(
      state.regionsLayer && findLayerByFeatureKey(state.regionsLayer, REGION_CODE_KEYS, regionKey)?.feature,
      REGION_NAME_KEYS,
      ""
    );
    renderTable("departements", deptFeatures, regionName);
  });

  // --- Département : charge les communautés rurales correspondantes ---
  deptSelect.addEventListener("change", async (e) => {
    const deptKey = e.target.value;
    state.tableActiveId = deptKey || null;
    showCommuneOutline(null);

    if (!deptKey) {
      populateCommuneSelect({ features: [] });
      // retombe sur le tableau du niveau région actif, ou régions si aucun
      const regionKey = regionSelect.value;
      if (regionKey) {
        const deptFeatures = state.allDepartementsGeoJSON.features.filter(
          (f) => String(getProp(f, DEPT_REGION_LINK_KEYS)).toLowerCase() === String(regionKey).toLowerCase()
        );
        renderTable("departements", deptFeatures);
      } else {
        const regionsFC = await fetchGeoJSON(regionsURL());
        renderTable("regions", regionsFC.features);
      }
      return;
    }

    const deptLayer = findLayerByFeatureKey(state.departementsLayer, DEPT_CODE_KEYS, deptKey);
    const deptName = getProp(deptLayer && deptLayer.feature, DEPT_NAME_KEYS, "");

    const communesFC = await loadCommunes(deptKey, deptName);
    populateCommuneSelect(communesFC);
    renderTable("communes", communesFC.features, deptName);
  });

  // --- Communauté rurale : dessine son contour + fiche info ---
  communeSelect.addEventListener("change", (e) => {
    const communeKey = e.target.value;
    state.tableActiveId = communeKey || null;

    if (!communeKey) {
      showCommuneOutline(null);
      return;
    }
    const feature = state.allCommunesGeoJSON.features.find(
      (f) => String(getProp(f, COMMUNE_CODE_KEYS)) === String(communeKey)
    );
    showCommuneOutline(feature || null);

    // remet la ligne active en évidence dans le tableau déjà affiché
    const tbody = document.getElementById("table-body");
    [...tbody.children].forEach((tr) => tr.classList.remove("active-row"));
    // (pas de ré-appel renderTable ici : évite de perdre le scroll de l'utilisateur)
  });

  // --- Ouverture / fermeture du tiroir tableau ---
  toggleBtn.addEventListener("click", () => {
    const isOpen = drawer.classList.toggle("open");
    drawer.setAttribute("aria-hidden", String(!isOpen));
    toggleBtn.setAttribute("aria-expanded", String(isOpen));
  });
  closeBtn.addEventListener("click", () => {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    toggleBtn.setAttribute("aria-expanded", "false");
  });
}

// -------------------------------------------------------------------------
// 7. Démarrage — indépendant du start() d'app.js pour ne pas dépendre de
//    son minutage interne : on recharge simplement regions.geojson (coût
//    négligeable, mis en cache HTTP par le navigateur) pour peupler le
//    tableau initial dès que possible.
// -------------------------------------------------------------------------
async function startTerritoire() {
  wireTerritoireUI();
  try {
    const regionsFC = await fetchGeoJSON(regionsURL());
    renderTable("regions", regionsFC.features);
  } catch (err) {
    console.error("Erreur d'initialisation du tableau territorial :", err);
  }
}

document.addEventListener("DOMContentLoaded", startTerritoire);
