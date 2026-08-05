// ==========================================
// --- TACTICAL 3D RULER (ruler-engine.js) ---
// ==========================================

let isDrawingRuler = false;
let rulerStartPoint = null;
let rulerLineLayer = null;
let rulerTooltipLayer = null;

document.addEventListener('DOMContentLoaded', () => {
    if (typeof map === 'undefined') return;

    // Prevent the default browser "auto-scroll" cursor on middle click
    map.getContainer().addEventListener('mousedown', (e) => {
        if (e.button === 1) e.preventDefault(); 
    });

    map.on('mousedown', function(e) {
        // e.originalEvent.button === 1 is the Middle Mouse Button
        if (e.originalEvent.button === 1) {
            isDrawingRuler = true;
            rulerStartPoint = e.latlng;
            map.dragging.disable(); // Stop the map from panning while dragging

            // Clear previous ruler if it exists (failsafe)
            if (rulerLineLayer) map.removeLayer(rulerLineLayer);
            if (rulerTooltipLayer) map.removeLayer(rulerTooltipLayer);

            // Create a dashed tactical line
            rulerLineLayer = L.polyline([rulerStartPoint, rulerStartPoint], {
                color: '#00e5ff', 
                weight: 2, 
                dashArray: '6, 6',
                interactive: false
            }).addTo(map);

            // Create the floating HUD tooltip
            rulerTooltipLayer = L.tooltip({ 
                permanent: true, 
                direction: 'right', 
                offset: [15, 0],
                className: 'ruler-hud-tooltip' 
            })
            .setLatLng(rulerStartPoint)
            .setContent("Measuring...")
            .addTo(map);
        }
    });

    map.on('mousemove', function(e) {
        if (!isDrawingRuler || !window.currentMapData) return;

        const currentPoint = e.latlng;
        
        // Update line visual
        rulerLineLayer.setLatLngs([rulerStartPoint, currentPoint]);
        rulerTooltipLayer.setLatLng(currentPoint);

        // --- 1. SPATIAL MATH (Decoupled X/Y) ---
        const meta = window.currentMapData.metadata;
        const mapSizePixels = Math.abs(meta.mapExtent[2] !== undefined ? meta.mapExtent[2] : meta.mapExtent[1]);
        const physX = meta.physicalSizeMetersX || meta.physicalSizeMeters;
        const physY = meta.physicalSizeMetersY || meta.physicalSizeMeters;

        const scaleX = mapSizePixels / physX;
        const scaleY = mapSizePixels / physY;

        const dx = currentPoint.lng - rulerStartPoint.lng; // East/West
        const dy = currentPoint.lat - rulerStartPoint.lat; // North/South

        const trueMeterX = dx / scaleX;
        const trueMeterY = dy / scaleY;

        // Calculate standard 2D flat distance
        const flatDist = Math.sqrt((trueMeterX * trueMeterX) + (trueMeterY * trueMeterY));

        // --- 2. ELEVATION MATH (Z-Axis) ---
        let deltaZ = 0;
        let true3DDist = flatDist;

        if (typeof getElevationAtMapCoord === 'function') {
            const z1 = getElevationAtMapCoord(rulerStartPoint.lng, rulerStartPoint.lat);
            const z2 = getElevationAtMapCoord(currentPoint.lng, currentPoint.lat);
            deltaZ = z2 - z1;
            
            // 3D Pythagorean Theorem: x^2 + y^2 + z^2 = d^2
            true3DDist = Math.sqrt((flatDist * flatDist) + (deltaZ * deltaZ));
        }

        // --- 3. AZIMUTH (Bearing) ---
        let angle = Math.atan2(trueMeterX, trueMeterY) * (180 / Math.PI);
        if (angle < 0) angle += 360;
        const heading = Math.round(angle * 10) / 10;

        // Update the HUD
        rulerTooltipLayer.setContent(`
            <div style="font-family: monospace; font-size: 13px; line-height: 1.4;">
                <b style="color: #00e5ff; font-size: 15px;">${Math.round(true3DDist)}m</b> (3D)<br>
                Flat: ${Math.round(flatDist)}m<br>
                Elev: <span style="color: ${deltaZ > 0 ? '#2ecc71' : (deltaZ < 0 ? '#e74c3c' : '#fff')}">${deltaZ > 0 ? '+' : ''}${Math.round(deltaZ)}m</span><br>
                Brg:  ${heading}°
            </div>
        `);
    });

    // --- Instantly destroy the line on release ---
    map.on('mouseup', function(e) {
        if (e.originalEvent.button === 1 && isDrawingRuler) {
            isDrawingRuler = false;
            map.dragging.enable(); // Re-enable map panning

            // Destroy the drawing layers immediately
            if (rulerLineLayer) {
                map.removeLayer(rulerLineLayer);
                rulerLineLayer = null;
            }
            if (rulerTooltipLayer) {
                map.removeLayer(rulerTooltipLayer);
                rulerTooltipLayer = null;
            }
        }
    });
});