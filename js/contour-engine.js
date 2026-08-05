// ==========================================
// --- SQUAD TOPOGRAPHY ENGINE (contour-engine.js) ---
// ==========================================

let topoLayerGroup = null;
let isTopoActive = false;

document.addEventListener('DOMContentLoaded', () => {
    if (typeof map !== 'undefined' && map) {
        topoLayerGroup = L.layerGroup().addTo(map);
    }
});

window.toggleContourOverlay = function() {
    isTopoActive = !isTopoActive;
    const btn = document.getElementById('contour-toggle-btn');
    const legend = document.getElementById('topo-legend');

    if (isTopoActive) {
        if (btn) btn.classList.add('active-tool');
        if (legend) legend.style.display = 'block';
        if (topoLayerGroup && typeof map !== 'undefined') {
            setTimeout(generateElevationPolygons, 10);
        }
        console.log("Topographic Bands ON.");
    } else {
        if (btn) btn.classList.remove('active-tool');
        if (legend) legend.style.display = 'none';
        if (topoLayerGroup) {
            topoLayerGroup.clearLayers();
        }
        console.log("Topographic Bands OFF.");
    }
};

function generateElevationPolygons() {
    if (!topoLayerGroup) return;
    topoLayerGroup.clearLayers();
    
    if (typeof heightCtx === 'undefined' || !heightCtx || typeof masterMapSize === 'undefined' || !masterMapSize) {
        console.warn("Heightmap engine still loading.");
        return;
    }

    const mapSize = masterMapSize;
    const step = 100;              // Grid resolution step

    function getTier(elev) {
        if (elev < 80)  return 0;
        if (elev < 130) return 1;
        if (elev < 180) return 2;
        if (elev < 230) return 3;
        return 4;
    }

    function getTierColor(tier) {
        switch(tier) {
            case 0: return 'rgba(34, 139, 34, 0.2)';   
            case 1: return 'rgba(154, 205, 50, 0.2)';  
            case 2: return 'rgba(218, 165, 32, 0.25)'; 
            case 3: return 'rgba(205, 133, 63, 0.3)';  
            case 4: return 'rgba(139, 69, 19, 0.4)';   
        }
    }

    let grid = {};
    
    // 1. Scan across the entire coordinate space
    for (let x = 0; x < mapSize; x += step) {
        for (let y = 0; y < mapSize; y += step) {
            const sampleX = x + (step / 2);
            const sampleY = -(y + (step / 2));
            const elev = getElevationAtMapCoord(sampleX, sampleY);
            grid[`${x},${y}`] = getTier(elev);
        }
    }

    // 2. Render background fills across full map bounds
    for (let x = 0; x < mapSize; x += step) {
        for (let y = 0; y < mapSize; y += step) {
            const key = `${x},${y}`;
            const currentTier = grid[key];
            if (currentTier === undefined) continue;

            const bounds = [
                [ -y, x ],
                [ -(y + step), x + step ]
            ];

            const rect = L.rectangle(bounds, {
                color: 'transparent',
                weight: 0,
                fillColor: getTierColor(currentTier),
                fillOpacity: 1.0,
                interactive: false,
                pmIgnore: true,     // <--- Blinds Geoman from editing background fills
                snapIgnore: true    // <--- Prevents drawing snaps
            });
            topoLayerGroup.addLayer(rect);
        }
    }

    // 3. Render clean structural border lines across full map bounds
    for (let x = 0; x < mapSize; x += step) {
        for (let y = 0; y < mapSize; y += step) {
            const key = `${x},${y}`;
            const currentTier = grid[key];
            if (currentTier === undefined) continue;

            const rightTier = grid[`${x + step},${y}`];
            const bottomTier = grid[`${x},${y + step}`];

            if (rightTier !== undefined && rightTier !== currentTier) {
                const edgeLine = L.polyline([
                    [ -y, x + step ],
                    [ -(y + step), x + step ]
                ], { 
                    color: '#111111', 
                    weight: 1.5, 
                    interactive: false,
                    pmIgnore: true,     // <--- Blinds Geoman from editing contour lines
                    snapIgnore: true    // <--- Prevents drawing snaps
                });
                topoLayerGroup.addLayer(edgeLine);
            }

            if (bottomTier !== undefined && bottomTier !== currentTier) {
                const edgeLine = L.polyline([
                    [ -(y + step), x ],
                    [ -(y + step), x + step ]
                ], { 
                    color: '#111111', 
                    weight: 1.5, 
                    interactive: false,
                    pmIgnore: true,     // <--- Blinds Geoman from editing contour lines
                    snapIgnore: true    // <--- Prevents drawing snaps
                });
                topoLayerGroup.addLayer(edgeLine);
            }
        }
    }

    console.log("✅ Full-map topographic overlay generated successfully.");
}