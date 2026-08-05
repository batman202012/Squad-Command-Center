// ==========================================
// --- GRID TRACKER (grid-tracker.js) ---
// ==========================================

let mainGridLayer = null;
let keypadGridLayer = null;
let subKeypadGridLayer = null;
let globalGridOpacity = 0.15;

// Arrays to hold our label objects so we can move them dynamically
let gridColLabels = [];
let gridRowLabels = [];

function getSquadGridFromLatLng(latlng, mapSizePixels, pixelsPerMeter) {
    const x = latlng.lng;
    const y = -latlng.lat; 

    if (x < 0 || x > mapSizePixels || y < 0 || y > mapSizePixels) return "OUT OF BOUNDS";

    const mainGridPixels = 300 * pixelsPerMeter; 
    const keypadPixels = 100 * pixelsPerMeter;   
    const subKeypadPixels = (100 / 3) * pixelsPerMeter; 

    const colIndex = Math.floor(x / mainGridPixels);
    const rowIndex = Math.floor(y / mainGridPixels) + 1; 

    let colString = "";
    let tempCol = colIndex;
    while (tempCol >= 0) {
        colString = String.fromCharCode(65 + (tempCol % 26)) + colString;
        tempCol = Math.floor(tempCol / 26) - 1;
    }
    const mainGrid = `${colString}${rowIndex}`;

    const remX = x % mainGridPixels;
    const remY = y % mainGridPixels;
    const kpX = Math.min(Math.floor(remX / keypadPixels), 2);
    const kpY = Math.min(Math.floor(remY / keypadPixels), 2);
    const keypad = 7 - (kpY * 3) + kpX;

    const remKpX = remX % keypadPixels;
    const remKpY = remY % keypadPixels;
    const skpX = Math.min(Math.floor(remKpX / subKeypadPixels), 2);
    const skpY = Math.min(Math.floor(remKpY / subKeypadPixels), 2);
    const subKeypad = 7 - (skpY * 3) + skpX;

    return `${mainGrid}-${keypad}-${subKeypad}`;
}

function initGridTrackerUI(mapInstance) {
    const gridTrackerControl = L.control({position: 'bottomright'});

    gridTrackerControl.onAdd = function () {
        this._div = L.DomUtil.create('div', 'squad-grid-tracker');
        this.update("GRID: ---");
        return this._div;
    };

    gridTrackerControl.update = function (gridText) {
        this._div.innerHTML = `GRID: ${gridText}`;
    };

    gridTrackerControl.addTo(mapInstance);

    mapInstance.on('mousemove', function (e) {
        if (typeof masterMapSize !== 'undefined' && typeof meterScale !== 'undefined') {
            const gridText = getSquadGridFromLatLng(e.latlng, masterMapSize, meterScale);
            gridTrackerControl.update(gridText);
        }
    });
}

function getColumnLetter(colIndex) {
    let colString = "";
    let tempCol = colIndex;
    while (tempCol >= 0) {
        colString = String.fromCharCode(65 + (tempCol % 26)) + colString;
        tempCol = Math.floor(tempCol / 26) - 1;
    }
    return colString;
}

function drawPhysicalGrid(mapInstance, mapSizePixels, pixelsPerMeter, initialOpacity = 0.15) {
    globalGridOpacity = initialOpacity;

    if (!mapInstance.getPane('squadGridPane')) {
        mapInstance.createPane('squadGridPane');
        mapInstance.getPane('squadGridPane').style.zIndex = 250; 
        mapInstance.getPane('squadGridPane').style.pointerEvents = 'none';
    }

    if (mainGridLayer) mapInstance.removeLayer(mainGridLayer);
    if (keypadGridLayer) mapInstance.removeLayer(keypadGridLayer);
    if (subKeypadGridLayer) mapInstance.removeLayer(subKeypadGridLayer);

    mainGridLayer = L.layerGroup();
    keypadGridLayer = L.layerGroup();
    subKeypadGridLayer = L.layerGroup();

    // Reset sticky label tracking arrays
    gridColLabels = [];
    gridRowLabels = [];

    const mapMeters = mapSizePixels / pixelsPerMeter;
    const totalSegments = Math.ceil(mapMeters / (100/3));

    for (let i = 0; i <= totalSegments; i++) {
        const meters = i * (100 / 3);
        const pixelPos = meters * pixelsPerMeter;
        
        if (pixelPos > mapSizePixels + 1) break; 

        const isMain = (i % 9 === 0);
        const isKp = (i % 3 === 0) && !isMain;

        let weight = isMain ? 2 : 1;
        let opacityMultiplier = isMain ? 1 : (isKp ? 0.6 : 0.25);
        let dashArray = isMain ? null : (isKp ? null : '4, 6'); 
        let targetLayer = isMain ? mainGridLayer : (isKp ? keypadGridLayer : subKeypadGridLayer);

        // Vertical Lines
        L.polyline([[0, pixelPos], [-mapSizePixels, pixelPos]], {
            color: '#ffffff', weight: weight, opacity: globalGridOpacity * opacityMultiplier,
            dashArray: dashArray, interactive: false, pane: 'squadGridPane',
            pmIgnore: true // <--- TELLS GEOMAN TO IGNORE THIS LINE
        }).addTo(targetLayer);
        
        // Horizontal Lines
        L.polyline([[-pixelPos, 0], [-pixelPos, mapSizePixels]], {
            color: '#ffffff', weight: weight, opacity: globalGridOpacity * opacityMultiplier,
            dashArray: dashArray, interactive: false, pane: 'squadGridPane',
            pmIgnore: true // <--- TELLS GEOMAN TO IGNORE THIS LINE
        }).addTo(targetLayer);
    }

    // Generate Centered Labels and store them in tracking arrays
    const totalMainGrids = Math.ceil(mapMeters / 300);
    for (let c = 0; c < totalMainGrids; c++) {
        const xCenter = (c * 300 + 150) * pixelsPerMeter; 
        if(xCenter > mapSizePixels) break;

        let marker = L.marker([0, xCenter], {
            icon: L.divIcon({ className: 'grid-edge-label', html: getColumnLetter(c), iconSize: [30, 30], iconAnchor: [15, 15] }),
            pane: 'squadGridPane', interactive: false
        });
        marker.addTo(mainGridLayer);
        gridColLabels.push({ marker: marker, x: xCenter }); // Store for Sticky Top
    }

    for (let r = 0; r < totalMainGrids; r++) {
        const yCenter = (r * 300 + 150) * pixelsPerMeter;
        if(yCenter > mapSizePixels) break;

        let marker = L.marker([-yCenter, 0], {
            icon: L.divIcon({ className: 'grid-edge-label', html: (r + 1), iconSize: [30, 30], iconAnchor: [15, 15] }),
            pane: 'squadGridPane', interactive: false
        });
        marker.addTo(mainGridLayer);
        gridRowLabels.push({ marker: marker, y: yCenter }); // Store for Sticky Left
    }

    mainGridLayer.addTo(mapInstance);
    updateGridVisibility(mapInstance);

    // --- STICKY LABEL EVENT LISTENERS ---
    // Remove old listener to prevent memory leaks when changing maps
    mapInstance.off('move', window.stickyLabelHandler);
    window.stickyLabelHandler = () => updateStickyLabels(mapInstance, mapSizePixels);
    mapInstance.on('move', window.stickyLabelHandler);
    
    // Call once to lock them to the screen on load
    updateStickyLabels(mapInstance, mapSizePixels);
}

// Calculates the viewport bounds and mathematically slides the labels along the edge
function updateStickyLabels(mapInstance, mapSizePixels) {
    if (!mapInstance) return;
    
    // Convert a strict 25-pixel screen offset into dynamic map coordinates based on current zoom
    const leftPaddingLng = mapInstance.containerPointToLatLng([25, 0]).lng;
    const topPaddingLat = mapInstance.containerPointToLatLng([0, 25]).lat;

    // Calculate current visible left edge. Limit it so it can't float off the left side of the map (0).
    let currentLeftX = Math.max(0, leftPaddingLng);
    currentLeftX = Math.min(currentLeftX, mapSizePixels); 

    // Calculate current visible top edge. Limit it so it can't float above the top of the map (0).
    let currentTopY = Math.min(0, topPaddingLat);
    currentTopY = Math.max(currentTopY, -mapSizePixels);

    // Update Top Letters (X stays the same, Y slides)
    gridColLabels.forEach(item => {
        item.marker.setLatLng([currentTopY, item.x]);
    });

    // Update Left Numbers (Y stays the same, X slides)
    gridRowLabels.forEach(item => {
        item.marker.setLatLng([-item.y, currentLeftX]);
    });
}

function updateGridVisibility(mapInstance) {
    const zoom = mapInstance.getZoom();
    
    if (zoom >= 4) {
        if (!mapInstance.hasLayer(keypadGridLayer)) mapInstance.addLayer(keypadGridLayer);
    } else {
        if (mapInstance.hasLayer(keypadGridLayer)) mapInstance.removeLayer(keypadGridLayer);
    }

    if (zoom >= 5) {
        if (!mapInstance.hasLayer(subKeypadGridLayer)) mapInstance.addLayer(subKeypadGridLayer);
    } else {
        if (mapInstance.hasLayer(subKeypadGridLayer)) mapInstance.removeLayer(subKeypadGridLayer);
    }
}

function updateGridOpacity(opacityValue) {
    globalGridOpacity = opacityValue;
    
    const updatePathOpacity = (layerGroup, multiplier) => {
        if (!layerGroup) return;
        layerGroup.eachLayer(layer => {
            if (layer instanceof L.Polyline) { 
                layer.setStyle({ opacity: globalGridOpacity * multiplier });
            }
        });
    };

    updatePathOpacity(mainGridLayer, 1);
    updatePathOpacity(keypadGridLayer, 0.6);
    updatePathOpacity(subKeypadGridLayer, 0.25);
}