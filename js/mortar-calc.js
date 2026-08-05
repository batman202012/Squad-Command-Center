// ==========================================
// --- SQUAD MORTAR CALCULATOR (mortar-calc.js) ---
// ==========================================

let activeMortarPit = null; 
let mortarTargetsLayer = L.layerGroup().addTo(map);

function calculateMortarFiringSolution(pitLatLng, targetLatLng) {
    if (!window.currentMapData) return { heading: 0, mils: "OOR", distance: 0, deltaZ: 0 };

    // 1. Grab metadata and master map size
    const meta = window.currentMapData.metadata;
    const mapSizePixels = Math.abs(meta.mapExtent[2] !== undefined ? meta.mapExtent[2] : meta.mapExtent[1]);

    // 2. Grab independent physical sizes
    const physX = meta.physicalSizeMetersX || meta.physicalSizeMeters;
    const physY = meta.physicalSizeMetersY || meta.physicalSizeMeters;

    // 3. Calculate independent scales
    const scaleX = mapSizePixels / physX;
    const scaleY = mapSizePixels / physY;

    // 4. Find the raw Leaflet coordinate differences
    const dx = targetLatLng.lng - pitLatLng.lng; 
    const dy = targetLatLng.lat - pitLatLng.lat; 

    // 5. "Descale" the Leaflet units back into pure physical meters
    const trueMeterX = dx / scaleX;
    const trueMeterY = dy / scaleY;

    // 6. Calculate True Physical Distance (Flat)
    const rawDistMeters = Math.sqrt((trueMeterX * trueMeterX) + (trueMeterY * trueMeterY));

    // 7. Calculate True Physical Bearing
    let angle = Math.atan2(trueMeterX, trueMeterY) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    const heading = Math.round(angle * 10) / 10; 

    // ==========================================
    // --- ELEVATION COMPENSATION MATH ---
    // ==========================================
    let deltaZ = 0;
    let effectiveDistMeters = rawDistMeters;

    // Only run the elevation math if your heightmap engine is active
    if (typeof getElevationAtMapCoord === 'function') {
        const pitElev = getElevationAtMapCoord(pitLatLng.lng, pitLatLng.lat);
        const targetElev = getElevationAtMapCoord(targetLatLng.lng, targetLatLng.lat);
        
        // Positive delta means target is HIGHER. Negative means target is LOWER.
        deltaZ = targetElev - pitElev;

        // Apply the Squad ballistic elevation modifier (2.1 meters of range per 1 meter of height)
        // If target is 100m higher, the shell must travel as if the target were 210m further away.
        effectiveDistMeters = rawDistMeters + (deltaZ * 2.1);
    }

    // 8. Calculate Mils using the EFFECTIVE distance
    let mils = "OOR"; 
    // Constrain the effective distance to standard 82mm limits
    if (effectiveDistMeters >= 50 && effectiveDistMeters <= 1250) {
        mils = Math.round(1583.51 - (0.21321 * effectiveDistMeters) - (0.0000713 * (effectiveDistMeters * effectiveDistMeters)));
    }

    return { 
        heading: heading, 
        mils: mils, 
        distance: Math.round(rawDistMeters),
        deltaZ: Math.round(deltaZ) // Pass this back so the UI can show it!
    };
}

// Global function so tactical-menu.js can call it when we click the map!
window.createMortarTarget = function(latlng) {
    const data = calculateMortarFiringSolution(activeMortarPit.getLatLng(), latlng);
    const targetGroup = L.featureGroup().addTo(mortarTargetsLayer);

    const splash = L.circle(latlng, {
        radius: 15 * meterScale,
        color: '#444',
        fillColor: '#888',
        fillOpacity: 0.6,
        weight: 1,
        className: 'leaflet-interactive' 
    }).addTo(targetGroup);

    const label = L.marker(latlng, {
        icon: L.divIcon({
            className: 'mortar-target-label',
            html: `<b>${data.heading}°</b><br/>${data.mils}`,
            iconSize: [60, 40],
            iconAnchor: [30, 20]
        }),
        interactive: false
    }).addTo(targetGroup);

    targetGroup.latlng = latlng; 

    splash.on('contextmenu', (e) => {
        L.DomEvent.stop(e.originalEvent);
        mortarTargetsLayer.removeLayer(targetGroup);
    });
};

window.recalculateAllMortarTargets = function() {
    if (!activeMortarPit) return;
    mortarTargetsLayer.eachLayer((group) => {
        const data = calculateMortarFiringSolution(activeMortarPit.getLatLng(), group.latlng);
        group.eachLayer((layer) => {
            if (layer.setIcon) {
                layer.setIcon(L.divIcon({
                    className: 'mortar-target-label',
                    html: `<b>${data.heading}°</b><br/>${data.mils}`,
                    iconSize: [60, 40],
                    iconAnchor: [30, 20]
                }));
            }
        });
    });
};

const mortarBtn = document.getElementById('mortar-calc-btn');
if (mortarBtn) {
    mortarBtn.addEventListener('click', () => {
        // isMortarCalcActive is controlled by globals.js
        isMortarCalcActive = !isMortarCalcActive;
        
        if (isMortarCalcActive) {
            if (typeof isLosActive !== 'undefined' && isLosActive) toggleLOSMode(); 
            map.pm.disableDraw();
            mortarBtn.classList.add('active-tool');
            console.log("Mortar Calc ON. Click a placed Friendly Mortar to select it.");
        } else {
            mortarBtn.classList.remove('active-tool');
            activeMortarPit = null; 
            console.log("Mortar Calc OFF.");
        }
    });
}