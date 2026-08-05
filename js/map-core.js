// ==========================================
// --- MAP INITIALIZATION (map-core.js) ---
// ==========================================

var mapMinZoom = 0;
var mapMaxZoom = 6; // Default starting ceiling
var mapMaxResolution = 1.00000000;
// Set a static baseline resolution based on max possible zoom. 
// Do NOT mutate this after map initialization.
var currentMapMinResolution = Math.pow(2, mapMaxZoom) * mapMaxResolution;

var crs = L.CRS.Simple;
crs.transformation = new L.Transformation(1, 0, -1, 0);
crs.scale = function(zoom) { return Math.pow(2, zoom) / currentMapMinResolution; };
crs.zoom = function(scale) { return Math.log(scale * currentMapMinResolution) / Math.LN2; };

// Initialize map with default options
var map = new L.Map('map', {
    maxZoom: mapMaxZoom,
    minZoom: mapMinZoom,
    crs: crs,
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true // Locks vectors to the background tiles during zoom
});

map.pm.setGlobalOptions({
    snapTo: false,
    snapping: false,
    snappable: false,
    snapIgnore: true
});

// Global references
var baseTileLayer = null;
var heightmapOverlay = null;
var currentMapData = null;
var masterMapSize = 0;
var meterScale = 0;

var currentMapStyle = 'base'; 
var currentActiveMapId = null;

// --- CLOUDFLARE TUNNEL URL ---
const TILE_SERVER_URL = 'https://maps.tpun.online/maps/maps';

window.setMapStyle = function(style) {
    if (currentMapStyle === style) return; // Ignore if they click the active button
    currentMapStyle = style;
    
    // 1. Update UI active states
    document.querySelectorAll('.map-style-btn').forEach(btn => {
        if (btn.getAttribute('data-style') === style) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 2. If a map is currently loaded, hot-swap the tiles instantly
    if (currentActiveMapId && currentMapData) {
        swapTileLayer(currentActiveMapId, currentMapData);
    }
};

function swapTileLayer(mapId, data) {
    const jsonMinZoom = data.metadata.minZoom !== undefined ? data.metadata.minZoom : 2;
    const jsonMaxZoom = data.metadata.maxZoom !== undefined ? data.metadata.maxZoom : 6;
    const bounds = L.latLngBounds([data.metadata.mapExtent[1], data.metadata.mapExtent[0]], [data.metadata.mapExtent[3], data.metadata.mapExtent[2]]);

    // 1. Determine which style suffix is currently active
    let styleSuffix = "_tiles";
    if (currentMapStyle === 'topo') {
        styleSuffix = "_topomap_tiles";
    } else if (currentMapStyle === 'terrain') {
        styleSuffix = "_terrainmap_tiles";
    }

    // 2. Format the strings to match Linux case-sensitivity
    // Forces "Anvil" for the folder, and "anvil" for the file prefix
    const folderName = mapId.charAt(0).toUpperCase() + mapId.slice(1).toLowerCase();
    const prefixName = mapId.toLowerCase();

    // 3. Construct the clean URL 
    const activeTileUrl = `${TILE_SERVER_URL}/${folderName}/${prefixName}${styleSuffix}/{z}/{x}/{y}.png`;

    if (!baseTileLayer) {
        // 3a. First time loading the app: Create the layer from scratch
        baseTileLayer = L.tileLayer(activeTileUrl, {
            minZoom: jsonMinZoom,
            maxZoom: jsonMaxZoom,
            bounds: bounds,
            tileSize: 256,
            noWrap: true,
            tms: false,
            errorTileUrl: '' 
        }).addTo(map);
    } else {
        // 3b. Hot-swapping maps: Update limits dynamically
        baseTileLayer.options.minZoom = jsonMinZoom;
        baseTileLayer.options.maxZoom = jsonMaxZoom;
        baseTileLayer.options.bounds = bounds;
        
        // Use Leaflet's native method to cleanly flush and redraw the tile queue
        baseTileLayer.setUrl(activeTileUrl);
    }
    
    // 4. Ensure the tiles stay behind tactical vectors
    baseTileLayer.bringToBack(); 
}

// ==========================================
// --- 1. THE UNIVERSAL MAP LOADER ---
// ==========================================
window.loadMap = async function(mapId) {
    if (!mapId) return; 

    try {
        const fs = require('fs');
        const path = require('path');
        
        const mapsDir = path.join(__dirname, 'assets', 'maps');
        const targetNameLower = mapId.toLowerCase();

        // ==============================================================
        // --- 1. CASE-INSENSITIVE SCANNER (THE ASAR FIX) ---
        // ==============================================================
        // We read the directory first and match the string regardless of capitalization
        const allFiles = fs.readdirSync(mapsDir);
        
        let exactJsonName = null;
        let exactFolderName = null;

        for (const item of allFiles) {
            const itemLower = item.toLowerCase();
            if (itemLower === `${targetNameLower}.json`) exactJsonName = item;
            if (itemLower === targetNameLower) exactFolderName = item;
        }

        if (!exactJsonName) {
            throw new Error(`Could not find map JSON for ${mapId} in ASAR archive.`);
        }

        // 2. Load the Master Map JSON using the exact, real filename
        const jsonPath = path.join(mapsDir, exactJsonName);
        const rawData = fs.readFileSync(jsonPath, 'utf8');
        const data = JSON.parse(rawData);
        
        currentMapData = data;

        // --- DYNAMIC CALCULATIONS ---
        const mapExtent = data.metadata.mapExtent;
        masterMapSize = Math.abs(mapExtent[2] !== undefined ? mapExtent[2] : mapExtent[1]); 
        meterScale = masterMapSize / data.metadata.physicalSizeMeters;

        const jsonMinZoom = data.metadata.minZoom !== undefined ? data.metadata.minZoom : 2;
        const jsonMaxZoom = data.metadata.maxZoom !== undefined ? data.metadata.maxZoom : 6;

        currentMapMinResolution = Math.pow(2, jsonMaxZoom) * mapMaxResolution;

        map.options.crs = crs;
        map.setMinZoom(jsonMinZoom);
        map.setMaxZoom(jsonMaxZoom);
        
        const bounds = L.latLngBounds([mapExtent[1], mapExtent[0]], [mapExtent[3], mapExtent[2]]);
        currentActiveMapId = mapId;
        
        // --- TRIGGER TILE SWAP ---
        swapTileLayer(mapId, data);
        
        map.fitBounds(bounds);

        if (heightmapOverlay) {
            map.removeLayer(heightmapOverlay);
            heightmapOverlay = null;
        }

        if (map.pm) map.pm.getGeomanLayers().forEach(layer => map.removeLayer(layer));
        if (window.mortarTargetsLayer) window.mortarTargetsLayer.clearLayers();

        // ==============================================================
        // --- 3. BULLETPROOF LAYER AUTO-DETECTION ---
        // ==============================================================
        let availableLayers = [];
        
        // If the scanner found the specific layer folder, read it!
        if (exactFolderName) {
            const mapLayersDir = path.join(mapsDir, exactFolderName);
            if (fs.existsSync(mapLayersDir)) {
                const layerFiles = fs.readdirSync(mapLayersDir);
                availableLayers = layerFiles
                    .filter(file => file.toLowerCase().endsWith('.json'))
                    // This regex safely strips the .json but preserves your exact crazy capitalization!
                    .map(file => file.replace(/\.json$/i, '')); 
            }
        } else {
            console.warn(`Layer folder not found in ASAR for: ${mapId}`);
        }

        // --- TRIGGER OTHER ENGINES ---
        if (window.updateLayerDropdown) window.updateLayerDropdown(mapId, availableLayers);
        if (window.loadHeightmap) window.loadHeightmap(data.metadata.heightmapUrl, data.metadata.heightmapSize);

        // --- DRAW SQUAD TACTICAL GRIDS ---
        if (typeof drawPhysicalGrid === 'function') {
            const slider = document.getElementById('grid-opacity-slider');
            const op = slider ? parseFloat(slider.value) : 0.15;
            
            drawPhysicalGrid(map, masterMapSize, meterScale, op);
            
            map.off('zoomend', window.gridZoomHandler);
            window.gridZoomHandler = () => updateGridVisibility(map);
            map.on('zoomend', window.gridZoomHandler);
        }

        if (typeof loadHabData === 'function') {
            loadHabData(mapId, map, masterMapSize, meterScale);
            
            if (typeof setupHabInteractivity === 'function') {
                setupHabInteractivity(map, meterScale);
            }
        }

        console.log(`✅ Successfully loaded Map Engine: ${data.name} with ${availableLayers.length} layers.`);

    } catch (err) {
        console.error(`🚨 Failed to load map data for ${mapId}.`, err);
    }
};

// ==========================================
// --- 3. EVENT LISTENERS & BOOT SEQUENCE ---
// ==========================================

// Listen for Map Dropdown Changes
document.getElementById('squad-map-select').addEventListener('change', (e) => {
    const selectedMap = e.target.value;
    loadMap(selectedMap);
});

// Safe Initial Boot Load
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize the dynamic hover text UI
    if (typeof initGridTrackerUI === 'function') {
        initGridTrackerUI(map);
    }

    // 2. Wire up the settings menu slider to control grid opacity
    const opacitySlider = document.getElementById('grid-opacity-slider');
    if (opacitySlider) {
        opacitySlider.addEventListener('input', function(e) {
            if (typeof updateGridOpacity === 'function') {
                updateGridOpacity(parseFloat(e.target.value));
            }
        });
    }

    // 3. Wire up the HAB overlay toggle checkbox
    const habToggle = document.getElementById('toggle-hab-overlay');
    if (habToggle) {
        habToggle.addEventListener('change', function(e) {
            if (typeof setHabOverlayVisible === 'function') {
                setHabOverlayVisible(e.target.checked);
            }
        });
    }

    // 4. Load the initial map
    const mapSelect = document.getElementById('squad-map-select');
    // Ensure we don't pass an empty string if the select default is disabled
    const initialMap = mapSelect && mapSelect.value ? mapSelect.value : 'Albasrah';
    loadMap(initialMap); 
});