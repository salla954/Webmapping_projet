/* =========================================================================
   SITS SÉNÉGAL — Module Régions & Départements
   Rôle dans le projet : consommation de l'API REST (AJAX/Fetch) +
   affichage/interaction des couches Régions et Départements sur Leaflet.

   -------------------------------------------------------------------------
   CONTRAT D'API attendu (à transmettre à la personne qui fait l'API Python)
   -------------------------------------------------------------------------
   GET {API_BASE_URL}/regions
     -> FeatureCollection GeoJSON des régions

   GET {API_BASE_URL}/departements
     -> FeatureCollection GeoJSON de TOUS les départements
   GET {API_BASE_URL}/departements?region=<code_ou_nom_region>
     -> FeatureCollection GeoJSON des départements d'une région donnée

   GET {API_BASE_URL}/regions/search?q=<texte>
   GET {API_BASE_URL}/departements/search?q=<texte>
     -> recherche texte (bonus, pas bloquant pour commencer)

   Tant que l'API n'existe pas, ce fichier lit directement les fichiers
   GeoJSON dans data/. Il suffit de passer CONFIG.USE_API à true et de
   renseigner CONFIG.API_BASE_URL le jour où l'API est prête : aucune autre
   ligne de ce fichier n'a besoin de changer.
   ========================================================================= */

const CONFIG = {
  USE_API: false, // passer à true quand l'API Python est prête
  API_BASE_URL: "http://127.0.0.1:5000/api",

  // Chemins locaux utilisés tant que USE_API = false.
  // Adapte les noms de fichiers à ceux que tu as réellement dans data/.
  LOCAL_REGIONS_PATH: "data/regions.geojson",
  LOCAL_DEPARTEMENTS_PATH: "data/departements.geojson",
};

// Noms de propriétés confirmés dans les fichiers fournis (regions.geojson,
// departements.geojson) : nom, code, region_code. Les listes ci-dessous
// gardent quelques alias au cas où d'autres fichiers de l'équipe (SHP
// convertis, etc.) utiliseraient des noms légèrement différents.
const REGION_NAME_KEYS = ["nom", "NOM_REG", "name"];
const REGION_CODE_KEYS = ["code", "CODE_REG"];
const DEPT_NAME_KEYS   = ["nom", "NOM_DEPT", "name"];
const DEPT_CODE_KEYS   = ["code", "CODE_DEPT"];
const DEPT_REGION_LINK_KEYS = ["region_code", "region_nom"]; // champ qui relie un département à sa région

function getProp(feature, keys, fallback = "—") {
  const props = feature.properties || {};
  for (const k of keys) {
    if (props[k] !== undefined && props[k] !== null && props[k] !== "") return props[k];
  }
  return fallback;
}

// ---------------------------------------------------------------------
// État global du module
// ---------------------------------------------------------------------
const state = {
  map: null,
  regionsLayer: null,
  departementsLayer: null,
  allDepartementsGeoJSON: null, // gardé en mémoire pour filtrer côté client
  activeLayer: null,            // layer Leaflet actuellement mis en évidence
};

// ---------------------------------------------------------------------
// 1. Initialisation de la carte
// ---------------------------------------------------------------------
function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
  }).setView([14.4974, -14.4524], 7); // centre approximatif du Sénégal

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(state.map);

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles &copy; Esri", maxZoom: 19 }
  );

  L.control.layers(
    { "Fond clair (OSM)": osm, "Fond satellite": satellite },
    {}, // les overlays (régions/départements) sont ajoutés dans loadRegions/loadDepartements
    { collapsed: false, position: "topright" }
  ).addTo(state.map);
}

// ---------------------------------------------------------------------
// 2. Couche AJAX générique — c'est ici que se fait la "consommation d'API"
// ---------------------------------------------------------------------
async function fetchGeoJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Échec du chargement (${response.status}) : ${url}`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.features)) {
    throw new Error(`Réponse invalide, FeatureCollection attendue : ${url}`);
  }
  return data;
}

function regionsURL() {
  return CONFIG.USE_API ? `${CONFIG.API_BASE_URL}/regions` : CONFIG.LOCAL_REGIONS_PATH;
}

function departementsURL(regionKey) {
  if (!CONFIG.USE_API) return CONFIG.LOCAL_DEPARTEMENTS_PATH; // filtrage fait côté client
  const base = `${CONFIG.API_BASE_URL}/departements`;
  return regionKey ? `${base}?region=${encodeURIComponent(regionKey)}` : base;
}

// ---------------------------------------------------------------------
// 3. Couche Régions
// ---------------------------------------------------------------------
async function loadRegions() {
  setStatus("Chargement des régions…");
  const geojson = await fetchGeoJSON(regionsURL());

  state.regionsLayer = L.geoJSON(geojson, {
    style: () => ({
      color: "#0d9488",
      weight: 2,
      fillColor: "#14b8a6",
      fillOpacity: 0.12,
    }),
    onEachFeature: (feature, layer) => {
      const name = getProp(feature, REGION_NAME_KEYS);
      const code = getProp(feature, REGION_CODE_KEYS);

      layer.bindPopup(buildPopupHTML(name, [
        ["Code", code],
        ["Type", "Région"],
      ]));

      layer.on("click", () => {
        highlightLayer(layer);
        zoomToLayer(layer);
        showInfoPanel(name, [
          ["Code", code],
          ["Type", "Région"],
        ]);
      });

      layer.on("mouseover", () => layer.setStyle({ weight: 3, fillOpacity: 0.25 }));
      layer.on("mouseout", () => {
        if (layer !== state.activeLayer) layer.setStyle({ weight: 2, fillOpacity: 0.12 });
      });
    },
  }).addTo(state.map);

  populateRegionSelect(geojson);
  appendStatus(`${geojson.features.length} région(s) chargée(s).`);
}

function populateRegionSelect(geojson) {
  const select = document.getElementById("region-select");
  geojson.features
    .map((f) => ({ name: getProp(f, REGION_NAME_KEYS), key: getProp(f, REGION_CODE_KEYS, getProp(f, REGION_NAME_KEYS)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ name, key }) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = name;
      select.appendChild(option);
    });
}

// ---------------------------------------------------------------------
// 4. Couche Départements
// ---------------------------------------------------------------------
async function loadDepartements(regionKey = "") {
  setStatus("Chargement des départements…");

  // On charge une seule fois toute la couche, puis on filtre côté client
  // (fonctionne à la fois en mode local et en mode API).
  if (!state.allDepartementsGeoJSON) {
    state.allDepartementsGeoJSON = await fetchGeoJSON(departementsURL());
  }

  const filtered = regionKey
    ? {
        type: "FeatureCollection",
        features: state.allDepartementsGeoJSON.features.filter((f) => {
          // Comparaison stricte : les codes région sont numériques ("1" ne doit
          // pas matcher "10", "11"... d'où l'égalité exacte plutôt qu'un "includes").
          const link = String(getProp(f, DEPT_REGION_LINK_KEYS, "")).toLowerCase();
          return link === String(regionKey).toLowerCase();
        }),
      }
    : state.allDepartementsGeoJSON;

  if (state.departementsLayer) {
    state.map.removeLayer(state.departementsLayer);
  }

  state.departementsLayer = L.geoJSON(filtered, {
    style: () => ({
      color: "#b45309",
      weight: 1.5,
      fillColor: "#f59e0b",
      fillOpacity: 0.15,
    }),
    onEachFeature: (feature, layer) => {
      const name = getProp(feature, DEPT_NAME_KEYS);
      const code = getProp(feature, DEPT_CODE_KEYS);
      const region = getProp(feature, DEPT_REGION_LINK_KEYS);

      layer.bindPopup(buildPopupHTML(name, [
        ["Code", code],
        ["Région", region],
        ["Type", "Département"],
      ]));

      layer.on("click", () => {
        highlightLayer(layer);
        zoomToLayer(layer);
        showInfoPanel(name, [
          ["Code", code],
          ["Région", region],
          ["Type", "Département"],
        ]);
      });
    },
  }).addTo(state.map);

  populateDeptSelect(filtered);
  appendStatus(`${filtered.features.length} département(s) affiché(s).`);
}

function populateDeptSelect(geojson) {
  const select = document.getElementById("dept-select");
  select.innerHTML = "";

  if (geojson.features.length === 0) {
    select.appendChild(new Option("Aucun département trouvé", ""));
    return;
  }

  select.appendChild(new Option("— Sélectionnez un département —", ""));
  geojson.features
    .map((f) => ({ name: getProp(f, DEPT_NAME_KEYS), key: getProp(f, DEPT_CODE_KEYS, getProp(f, DEPT_NAME_KEYS)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(({ name, key }) => select.appendChild(new Option(name, key)));
}

// ---------------------------------------------------------------------
// 5. Interactions carte <-> UI
// ---------------------------------------------------------------------
function zoomToLayer(layer) {
  if (layer.getBounds) {
    state.map.fitBounds(layer.getBounds(), { maxZoom: 11, padding: [20, 20] });
  }
}

function highlightLayer(layer) {
  if (state.activeLayer && state.activeLayer !== layer) {
    resetLayerStyle(state.activeLayer);
  }
  layer.setStyle({ color: "#ef4444", weight: 3, fillOpacity: 0.3 });
  state.activeLayer = layer;
}

function resetLayerStyle(layer) {
  const isDept = state.departementsLayer && state.departementsLayer.hasLayer(layer);
  layer.setStyle(
    isDept
      ? { color: "#b45309", weight: 1.5, fillOpacity: 0.15 }
      : { color: "#0d9488", weight: 2, fillOpacity: 0.12 }
  );
}

function findLayerByFeatureKey(geoJsonLayer, keys, value) {
  let found = null;
  geoJsonLayer.eachLayer((layer) => {
    if (String(getProp(layer.feature, keys)) === String(value)) found = layer;
  });
  return found;
}

function buildPopupHTML(title, rows) {
  const rowsHTML = rows
    .map(([k, v]) => `<div class="popup-row"><b>${k}:</b> ${v}</div>`)
    .join("");
  return `<div class="popup-title">${title}</div>${rowsHTML}`;
}

function showInfoPanel(title, rows) {
  const panel = document.getElementById("info-panel");
  const rowsHTML = rows
    .map(([k, v]) => `<div class="info-row"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join("");
  panel.innerHTML = `<h2>Informations</h2><div class="info-row"><span class="k">Nom</span><span class="v">${title}</span></div>${rowsHTML}`;
}

function setStatus(text) {
  const el = document.getElementById("status-text");
  el.textContent = text;
  el.className = "status";
}
function appendStatus(text) {
  const el = document.getElementById("status-text");
  el.textContent = text;
  el.className = "status ok";
}
function setStatusError(text) {
  const el = document.getElementById("status-text");
  el.textContent = text;
  el.className = "status error";
}

// ---------------------------------------------------------------------
// 6. Écouteurs des listes déroulantes
// ---------------------------------------------------------------------
function wireUI() {
  const regionSelect = document.getElementById("region-select");
  const deptSelect = document.getElementById("dept-select");
  const resetBtn = document.getElementById("reset-btn");

  regionSelect.addEventListener("change", async (e) => {
    const regionKey = e.target.value;

    if (!regionKey) {
      await loadDepartements("");
      state.map.setView([14.4974, -14.4524], 7);
      return;
    }

    const layer = findLayerByFeatureKey(state.regionsLayer, REGION_CODE_KEYS, regionKey)
      || findLayerByFeatureKey(state.regionsLayer, REGION_NAME_KEYS, regionKey);
    if (layer) {
      highlightLayer(layer);
      zoomToLayer(layer);
      const name = getProp(layer.feature, REGION_NAME_KEYS);
      showInfoPanel(name, [["Code", getProp(layer.feature, REGION_CODE_KEYS)], ["Type", "Région"]]);
    }

    try {
      await loadDepartements(regionKey);
    } catch (err) {
      setStatusError(err.message);
    }
  });

  deptSelect.addEventListener("change", (e) => {
    const deptKey = e.target.value;
    if (!deptKey || !state.departementsLayer) return;

    const layer = findLayerByFeatureKey(state.departementsLayer, DEPT_CODE_KEYS, deptKey)
      || findLayerByFeatureKey(state.departementsLayer, DEPT_NAME_KEYS, deptKey);
    if (layer) {
      highlightLayer(layer);
      zoomToLayer(layer);
      const name = getProp(layer.feature, DEPT_NAME_KEYS);
      showInfoPanel(name, [
        ["Code", getProp(layer.feature, DEPT_CODE_KEYS)],
        ["Région", getProp(layer.feature, DEPT_REGION_LINK_KEYS)],
        ["Type", "Département"],
      ]);
    }
  });

  resetBtn.addEventListener("click", () => {
    regionSelect.value = "";
    deptSelect.value = "";
    if (state.activeLayer) {
      resetLayerStyle(state.activeLayer);
      state.activeLayer = null;
    }
    loadDepartements("");
    state.map.setView([14.4974, -14.4524], 7);
    document.getElementById("info-panel").innerHTML =
      '<h2>Informations</h2><p class="placeholder">Cliquez sur une région ou un département sur la carte, ou utilisez les listes ci-dessus.</p>';
  });
}

// ---------------------------------------------------------------------
// 7. Démarrage
// ---------------------------------------------------------------------
async function start() {
  initMap();
  wireUI();
  try {
    await loadRegions();
    await loadDepartements("");
  } catch (err) {
    console.error(err);
    setStatusError(
      "Erreur de chargement des données. Vérifie que data/regions.geojson " +
      "et data/departements.geojson existent (ou que l'API tourne si USE_API = true)."
    );
  }
}

document.addEventListener("DOMContentLoaded", start);
