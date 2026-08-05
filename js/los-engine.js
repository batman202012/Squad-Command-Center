// ==========================================
// --- SQUAD LOS ENGINE (los-engine.js) ---
// ==========================================

const heightmapImg = new Image();
let heightCanvas, heightCtx;
let heightmapSize = 4096; // Overwritten dynamically 

// Called by map-core.js when a new map is selected
window.loadHeightmap = function(url, size) {
    heightmapSize = size;
    heightmapImg.src = url;
    
    heightmapImg.onload = function() {
        heightCanvas = document.createElement('canvas');
        heightCanvas.width = heightmapSize;
        heightCanvas.height = heightmapSize;
        heightCtx = heightCanvas.getContext('2d');
        heightCtx.drawImage(heightmapImg, 0, 0);
        console.log('✅ Dynamic Heightmap successfully loaded for LOS engine.');
    };
};

// Helper: Get map size dynamically from metadata
function getMapSizePixels() {
    const activeMapData = window.currentMapData || (typeof currentMapData !== 'undefined' ? currentMapData : null);
    if (activeMapData && activeMapData.metadata && activeMapData.metadata.mapExtent) {
        const extent = activeMapData.metadata.mapExtent;
        return Math.abs(extent[2] !== undefined ? extent[2] : extent[1]);
    }
    return 8192; // Default fallback
}

// Helper: Strictly clamp Leaflet coordinates (Lng: 0 to Max, Lat: -Max to 0)
function clampLatLng(lat, lng) {
    const mapSize = getMapSizePixels();
    const clampedLng = Math.max(0, Math.min(mapSize, lng));
    const clampedLat = Math.max(-mapSize, Math.min(0, lat));
    return { lat: clampedLat, lng: clampedLng };
}

// 2. Fetch elevation safely with border clamping
function getElevationAtMapCoord(mapLng, mapLat) {
    if (!heightCtx || typeof heightmapSize === 'undefined') {
        return 0;
    }

    const mapSizePixels = getMapSizePixels();

    const clampedLng = Math.max(0, Math.min(mapSizePixels, mapLng));
    const clampedLat = Math.max(-mapSizePixels, Math.min(0, mapLat));

    const percentX = clampedLng / mapSizePixels;
    const percentY = -clampedLat / mapSizePixels;

    const imgX = Math.max(0, Math.min(heightmapSize - 1, Math.floor(percentX * heightmapSize)));
    const imgY = Math.max(0, Math.min(heightmapSize - 1, Math.floor(percentY * heightmapSize)));

    try {
        const pixel = heightCtx.getImageData(imgX, imgY, 1, 1).data;
        return pixel[0]; 
    } catch (e) {
        return 0; 
    }
}

// 3. High-Precision Raycaster Logic (Allows rays to reach full radius and clip at map edges)
const elevationScale = 1.5; 

function checkLineOfSight(startLng, startLat, endLng, endLat) {
    const mapSizePixels = getMapSizePixels();
    
    // Use full unclamped target vector so rays maintain their intended length
    const dx = endLng - startLng;
    const dy = endLat - startLat;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) return { hitLng: startLng, hitLat: startLat, isBlocked: false };

    const steps = Math.floor(distance / 2); 

    const startElev = (getElevationAtMapCoord(startLng, startLat) * elevationScale) + 2.0; 
    
    // Safe fallback target for end elevation estimation
    const clampedEnd = clampLatLng(endLat, endLng);
    const endElev = (getElevationAtMapCoord(clampedEnd.lng, clampedEnd.lat) * elevationScale) + 1.0; 

    for (let i = 1; i <= steps; i++) {
        const t = i / steps; 
        const sampleLng = startLng + dx * t;
        const sampleLat = startLat + dy * t;

        // If a ray steps outside map bounds, clamp it to the border and stop the ray there
        if (sampleLng < 0 || sampleLng > mapSizePixels || sampleLat > 0 || sampleLat < -mapSizePixels) {
            const clamped = clampLatLng(sampleLat, sampleLng);
            return { hitLng: clamped.lng, hitLat: clamped.lat, isBlocked: true };
        }

        const terrainElev = getElevationAtMapCoord(sampleLng, sampleLat) * elevationScale;
        const rayElev = startElev + (endElev - startElev) * t;

        // If terrain rises above the ray's trajectory, line of sight is blocked
        if (terrainElev >= rayElev) {
            return { hitLng: sampleLng, hitLat: sampleLat, isBlocked: true };
        }
    }
    
    // Reached full vision radius without hitting terrain or border
    return { hitLng: clampedEnd.lng, hitLat: clampedEnd.lat, isBlocked: false };
}

// 4. Interactive Pointer State & Logic
let observerPoint = null;
let visibleLine = null; 
let blockedLine = null; 
let viewshedPolygon = null; 

const visionRadius = 2500; 
const rayCount = 720;      

function drawViewshed(center) {
    if (viewshedPolygon && typeof map !== 'undefined') map.removeLayer(viewshedPolygon);
    
    const polygonPoints = [];
    
    for (let i = 0; i < rayCount; i++) {
        const angle = (i * 2 * Math.PI) / rayCount; 
        const rawTargetLng = center.lng + Math.cos(angle) * visionRadius;
        const rawTargetLat = center.lat + Math.sin(angle) * visionRadius; 
        
        const result = checkLineOfSight(center.lng, center.lat, rawTargetLng, rawTargetLat);
        polygonPoints.push([result.hitLat, result.hitLng]); 
    }
    
    if (typeof map !== 'undefined') {
        viewshedPolygon = L.polygon(polygonPoints, {
            color: '#00ff00', fillColor: '#00ff00', fillOpacity: 0.35, weight: 1, interactive: false 
        }).addTo(map);
    }
}

window.lockViewshedForDrawing = function() {
    if (typeof isLosActive !== 'undefined' && isLosActive) {
        isLosActive = false; 
        if (visibleLine && typeof map !== 'undefined') map.removeLayer(visibleLine);
        if (blockedLine && typeof map !== 'undefined') map.removeLayer(blockedLine);
        console.log("LOS Locked: You can now draw tactical plans over the viewshed.");
    }
};

window.toggleLOSMode = function() {
    isLosActive = !isLosActive;
    
    if (isLosActive) {
        if (typeof map !== 'undefined' && map.pm) map.pm.disableDraw(); 
        console.log("LOS Mode ON.");
    } else {
        observerPoint = null;
        if (visibleLine && typeof map !== 'undefined') map.removeLayer(visibleLine);
        if (blockedLine && typeof map !== 'undefined') map.removeLayer(blockedLine);
        if (viewshedPolygon && typeof map !== 'undefined') map.removeLayer(viewshedPolygon);
        console.log("LOS Mode OFF.");
    }
};

// THE GLOBAL MAP LEFT-CLICK LISTENER (Handles Mortar AND LOS)
if (typeof map !== 'undefined') {
    map.on('click', function(e) {
        if (typeof isMortarCalcActive !== 'undefined' && isMortarCalcActive) {
            if (!activeMortarPit) {
                console.log("WARNING: Click a Friendly Mortar icon first to set it as the active pit!");
                return;
            }
            createMortarTarget(e.latlng);
            return; 
        }

        if (typeof isLosActive === 'undefined' || !isLosActive) return;
        observerPoint = e.latlng;
        drawViewshed(observerPoint);
    });
}

const losButton = document.getElementById('los-toggle-btn');
if (losButton) {
    losButton.addEventListener('click', () => toggleLOSMode());
}