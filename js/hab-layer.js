// ==========================================
// --- HAB OVERLAY ENGINE (hab-layer.js) ---
// ==========================================

let habLayerGroup = null;
let habLegendControl = null;
let currentHabData = []; 
let isHabLoaded = false;

const habCanvasRenderer = L.canvas({ padding: 0.5 });

window.toggleHabOverlay = function() {
    const btn = document.getElementById('toggle-hab-btn');
    if (!btn) return;

    const isActive = btn.classList.toggle('active-tool');
    setHabOverlayVisible(isActive);
};

async function loadHabData(mapId, mapInstance, mapSizePixels, meterScale) {
    if (habLayerGroup) {
        mapInstance.removeLayer(habLayerGroup);
        habLayerGroup.clearLayers();
    }
    
    if (habLegendControl) {
        try { mapInstance.removeControl(habLegendControl); } catch(e){}
        habLegendControl = null;
    }

    habLayerGroup = L.layerGroup();
    currentHabData = [];
    isHabLoaded = false;

    try {
        const rawHabData = await require('electron').ipcRenderer.invoke('read-map-json', mapId);
        
        if (!rawHabData) {
            console.log(`ℹ️ No HAB placement data found for ${mapId}. Skipping overlay.`);
            return;
        }

        if (!Array.isArray(rawHabData) || rawHabData.length === 0) {
            console.log(`ℹ️ HAB data file for ${mapId} is empty.`);
            return;
        }

        const boxRadiusMeters = 2; 
        const boxRadiusPixels = boxRadiusMeters * meterScale;

        rawHabData.forEach(hab => {
            // 1. Convert UE cm to meters
            const ueX = hab.x / 100; // East / West
            const ueY = hab.y / 100; // North / South

            // 2. Grab independent physical sizes (Fallback to the standard if not set)
            const meta = window.currentMapData ? window.currentMapData.metadata : {};
            const physX = meta.physicalSizeMetersX || meta.physicalSizeMeters;
            const physY = meta.physicalSizeMetersY || meta.physicalSizeMeters;

            // 3. Calculate independent scales
            const scaleX = mapSizePixels / physX;
            const scaleY = mapSizePixels / physY;

            // 4. Safely apply the map-specific center offsets
            const offsetX = meta.ueOffsetX !== undefined ? meta.ueOffsetX : 0;
            const offsetY = meta.ueOffsetY !== undefined ? meta.ueOffsetY : 0;

            const correctedX = ueX + offsetX;
            const correctedY = ueY + offsetY;

            // 5. Apply the independent axis scales!
            const lat = -(mapSizePixels / 2) - (correctedY * scaleY); 
            const lng = (mapSizePixels / 2) + (correctedX * scaleX);

            currentHabData.push({ lat: lat, lng: lng, status: hab.status, z: hab.z });

            let boxColor = '#e74c3c'; 
            if (hab.status === 'perfect') boxColor = '#2ecc71'; 
            if (hab.status === 'tight') boxColor = '#f1c40f'; 

            const bounds = [
                [lat + boxRadiusPixels, lng - boxRadiusPixels],
                [lat - boxRadiusPixels, lng + boxRadiusPixels]
            ];

            L.rectangle(bounds, {
                renderer: habCanvasRenderer,
                color: boxColor,
                weight: 0,
                fillColor: boxColor,
                fillOpacity: 0.75,
                interactive: false
            }).addTo(habLayerGroup);
        });

        isHabLoaded = true;

        const habBtn = document.getElementById('toggle-hab-btn');
        if (habBtn && habBtn.classList.contains('active-tool')) {
            habLayerGroup.addTo(mapInstance);
            showHabLegend(mapInstance);
        }
        
        console.log(`✅ Loaded and auto-scaled ${rawHabData.length} HAB placement locations.`);

    } catch (err) {
        console.log(`ℹ️ No HAB placement data found for ${mapId} (${err.message}). Skipping overlay.`);
    }
}

function setHabOverlayVisible(visible) {
    if (typeof map === 'undefined' || !map) return;

    if (visible) {
        if (habLayerGroup && isHabLoaded) {
            if (!map.hasLayer(habLayerGroup)) {
                map.addLayer(habLayerGroup);
            }
        }
        showHabLegend(map);
    } else {
        if (habLayerGroup) {
            if (map.hasLayer(habLayerGroup)) {
                map.removeLayer(habLayerGroup);
            }
        }
        hideHabLegend(map);
    }
}

function showHabLegend(mapInstance) {
    if (!habLegendControl) {
        habLegendControl = L.control({ position: 'bottomleft' });
        habLegendControl.onAdd = function () {
            const div = L.DomUtil.create('div', 'hab-legend-control');
            div.innerHTML = `
                <h4>INDOOR HAB FIT</h4>
                <div class="legend-item"><span style="background: #2ecc71;"></span> Perfect</div>
                <div class="legend-item"><span style="background: #f1c40f;"></span> Tight / Clipping</div>
                <div class="legend-item"><span style="background: #e74c3c;"></span> Glitching</div>
            `;
            return div;
        };
    }
    
    try {
        mapInstance.addControl(habLegendControl);
    } catch (e) {}
}

function hideHabLegend(mapInstance) {
    if (habLegendControl) {
        try {
            mapInstance.removeControl(habLegendControl);
        } catch (e) {}
    }
}

function setupHabInteractivity(mapInstance, meterScale) {
    mapInstance.off('click', window.habClickHandler);

    window.habClickHandler = function(e) {
        const habBtn = document.getElementById('toggle-hab-btn');
        if (habBtn && !habBtn.classList.contains('active-tool')) return;
        if (currentHabData.length === 0) return;

        const clickToleranceLat = 4 * meterScale;
        const clickToleranceLng = 4 * meterScale;

        const clickedHab = currentHabData.find(hab => {
            return Math.abs(hab.lat - e.latlng.lat) <= clickToleranceLat && 
                   Math.abs(hab.lng - e.latlng.lng) <= clickToleranceLng;
        });

        if (clickedHab) {
            let color = clickedHab.status === 'perfect' ? '#2ecc71' : (clickedHab.status === 'tight' ? '#f1c40f' : '#e74c3c');
            
            L.popup()
                .setLatLng([clickedHab.lat, clickedHab.lng])
                .setContent(
                    `<div style="font-family: Arial; font-size: 12px;">
                        <b style="color: #e1b12c;">Indoor HAB Fit</b><br>
                        Status: <b style="color: ${color};">${clickedHab.status.toUpperCase()}</b><br>
                        Z-Elevation: ${Math.round(clickedHab.z)}
                    </div>`
                )
                .openOn(mapInstance);
        }
    };

    mapInstance.on('click', window.habClickHandler);
}