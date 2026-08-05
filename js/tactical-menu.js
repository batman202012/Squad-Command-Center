// ==========================================
// --- TACTICAL GRAPHICS & RADIAL MENU (tactical-menu.js) ---
// ==========================================

const ipcMenu = require('electron').ipcRenderer;

var currentContextLatLng = null;

// --- STEAM P2P: GLOBALS ---
window.isApplyingRemote = false; 
window.remoteTacticalId = null;

function generateTacticalId() { 
    return Math.random().toString(36).substr(2, 9); 
}

// --- CREATE A DEDICATED PANE FOR ZONES ---
if (!map.getPane('zonePane')) {
    map.createPane('zonePane');
    map.getPane('zonePane').style.zIndex = 350;
    map.getPane('zonePane').style.pointerEvents = 'auto'; 
}

// ==========================================
// --- 1. GEOMAN LIVE-DRAWING LOGIC ---
// ==========================================
// --- UI ACTIVE STATES FOR GEOMAN TOOLS ---
map.on('pm:globaleditmodetoggled', (e) => {
    const editBtn = document.querySelector('.tac-btn[data-action="Edit"]');
    if (editBtn) {
        if (e.enabled) editBtn.classList.add('active-tool-edit');
        else editBtn.classList.remove('active-tool-edit');
    }
});

map.on('pm:globalremovalmodetoggled', (e) => {
    const deleteBtn = document.querySelector('.tac-btn[data-action="Remove"]');
    if (deleteBtn) {
        if (e.enabled) deleteBtn.classList.add('active-tool-delete');
        else deleteBtn.classList.remove('active-tool-delete');
    }
});

map.on('pm:create', (e) => {
    const layer = e.layer;
    
    // 1. Tag everything so the wipe functions can cleanly delete it later
    layer.options.isTacticalGraphic = true;
    layer.isTacticalGraphic = true;

    // --- STEAM P2P: SYNC NEW SHAPES ---
    if (!window.isApplyingRemote) {
        layer.tacticalId = generateTacticalId();
        
        ipcMenu.send('p2p-broadcast-tactical', {
            action: 'draw-shape',
            id: layer.tacticalId,
            geojson: layer.toGeoJSON(),
            styleType: activeLineTool,
            squadNum: activeSquadNum 
        });
    }

    const cleanupAttachedGraphics = () => {
        if (layer.myDecorator) map.removeLayer(layer.myDecorator);
        if (layer.myBadge) map.removeLayer(layer.myBadge);
    };

    // 1. SHIFT+RIGHT-CLICK: Only attached to Lines (Movement/Frontlines)
    if (e.shape === 'Line') {
        layer.on('contextmenu', (evt) => {
            if (evt.originalEvent && evt.originalEvent.shiftKey) {
                L.DomEvent.stop(evt.originalEvent); 
                window.suppressContextMenu = true;
                setTimeout(() => { window.suppressContextMenu = false; }, 100);
                
                map.removeLayer(layer); 
                cleanupAttachedGraphics(); 

                if (!window.isApplyingRemote && layer.tacticalId) {
                    ipcMenu.send('p2p-broadcast-tactical', { action: 'delete', id: layer.tacticalId });
                }
            }
        });
    }

    // 2. FORCED REMOVAL MODE (Trash Can Tool)
    // Geoman's native eraser struggles to click shapes inside custom panes. 
    // This manually forces all shapes to delete themselves if the Eraser tool is active!
    layer.on('click', () => {
        if (map.pm.globalRemovalEnabled()) {
            map.removeLayer(layer);
            cleanupAttachedGraphics();
            
            if (!window.isApplyingRemote && layer.tacticalId) {
                ipcMenu.send('p2p-broadcast-tactical', { action: 'delete', id: layer.tacticalId });
            }
        }
    });

    // Live visual updates for decorators while dragging locally
    layer.on('pm:change', () => {
        if (layer.myDecorator) layer.myDecorator.setPaths(layer.getLatLngs());
        if (layer.myBadge) {
            const currentLatLngs = layer.getLatLngs();
            layer.myBadge.setLatLng(currentLatLngs[0]); 
        }
    });

    // STEAM P2P: Sync shape modifications (Edit Shapes tool)
    layer.on('pm:update', () => {
        if (window.isApplyingRemote || !layer.tacticalId) return;
        ipcMenu.send('p2p-broadcast-tactical', {
            action: 'update-shape',
            id: layer.tacticalId,
            geojson: layer.toGeoJSON()
        });
    });

    if (e.shape === 'Line' && activeLineTool) {
        if (activeLineTool.startsWith('frontline')) {
            const color = activeLineTool === 'frontline-friendly' ? '#ffcc00' : '#ff0000';
            layer.setStyle({ opacity: 0.01 });

            const zigzagIcon = L.divIcon({
                className: 'frontline-zigzag',
                html: `<svg width="20" height="20" viewBox="0 0 20 20">
                           <polyline points="20,20 0,10 20,0" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                       </svg>`,
                iconSize: [20, 20], iconAnchor: [10, 10]
            });
            layer.myDecorator = L.polylineDecorator(layer, {
                patterns: [ { offset: 0, repeat: 19.5, symbol: L.Symbol.marker({ rotate: true, markerOptions: { icon: zigzagIcon, interactive: false, pmIgnore: true } }) } ]
            }).addTo(map);
            layer.myDecorator.isTacticalGraphic = true; // Tag for deletion
        } 
        else if (activeLineTool.startsWith('movement')) {
            const isFriendly = activeLineTool === 'movement-friendly';
            const moveColor = isFriendly ? '#189b18' : '#cc0000'; 
            
            layer.myDecorator = L.polylineDecorator(layer, {
                patterns: [ { offset: '100%', repeat: 0, symbol: L.Symbol.arrowHead({ pixelSize: 15, polygon: true, pathOptions: { stroke: true, color: moveColor, fillOpacity: 1, weight: 2, pmIgnore: true, interactive: false } }) } ]
            }).addTo(map);
            layer.myDecorator.isTacticalGraphic = true; // Tag for deletion

            if (activeSquadNum) {
                const squadBadge = L.divIcon({
                    className: 'squad-vector-badge',
                    html: `<div style="background-color: #222; color: ${moveColor}; border: 2px solid ${moveColor}; width: 22px; height: 22px; text-align: center; line-height: 22px; font-weight: bold; border-radius: 4px; box-shadow: 0 0 5px rgba(0,0,0,0.8);">${activeSquadNum}</div>`,
                    iconSize: [26, 26], iconAnchor: [13, 13] 
                });
                const latlngs = layer.getLatLngs();
                layer.myBadge = L.marker(latlngs[0], { icon: squadBadge, interactive: false, pmIgnore: true, isTacticalGraphic: true }).addTo(map);
                layer.myBadge.isTacticalGraphic = true; // Tag for deletion
            }
        }
    }
    activeLineTool = null; 
});

// --- STEAM P2P: SYNC GLOBAL DELETIONS (Geoman Trash Can Tool) ---
map.on('pm:remove', (e) => {
    const layer = e.layer;
    
    // Clean up attached visual elements & rings
    if (layer.myDecorator) map.removeLayer(layer.myDecorator);
    if (layer.myBadge) map.removeLayer(layer.myBadge);
    if (layer.ringBuild) {
        map.removeLayer(layer.ringAudio);
        map.removeLayer(layer.ringBuild);
        map.removeLayer(layer.ringLockout);
    }
    
    // Recalculate triangulation if it was a radio
    if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();

    if (window.isApplyingRemote || !layer.tacticalId) return;
    ipcMenu.send('p2p-broadcast-tactical', { action: 'delete', id: layer.tacticalId });
});


// ==========================================
// --- TACTICAL BOARD CLEANUP ENGINE ---
// ==========================================
window.clearTacticalBoard = function() {
    map.eachLayer(layer => {
        // Aggressively target anything with our tag
        if ((layer.options && layer.options.isTacticalGraphic) || layer.isTacticalGraphic) {
            map.removeLayer(layer);
        }
    });

    if (window.smartRadioLayer) {
        map.removeLayer(window.smartRadioLayer);
        window.smartRadioLayer = null;
    }
    if (typeof activeMortarPit !== 'undefined') activeMortarPit = null;
    
    // WIPE BACKEND HISTORY: Stops ghosts from rendering on the next map
    ipcMenu.send('clear-tactical-history');
};

const mapSelectNode = document.getElementById('squad-map-select');
if (mapSelectNode) mapSelectNode.addEventListener('change', clearTacticalBoard);

const layerSelectNode = document.getElementById('squad-layer-select');
if (layerSelectNode) layerSelectNode.addEventListener('change', clearTacticalBoard);

// ==========================================
// --- SMART ENEMY RADIO TRIANGULATOR ---
// ==========================================
window.updateRadioTriangulation = function() {
    if (typeof turf === 'undefined') return;

    const allDeployables = [];
    const knownRadios = [];

    map.eachLayer(layer => {
        if (layer instanceof L.Marker && layer.shape) {
            const isEnemy = layer.options.icon && 
                            layer.options.icon.options && 
                            layer.options.icon.options.className.includes('icon-enemy');
            
            if (isEnemy) {
                const s = layer.shape;
                if (['HAB', 'Repair', 'Observe', 'Ammocrate', 'Tow', 'Machinegun', 'AA', 'Fireshelter', 'Mortar-Enemy'].includes(s)) {
                    allDeployables.push(layer.getLatLng());
                } else if (s === 'FOB-Enemy') {
                    knownRadios.push(layer.getLatLng());
                }
            }
        }
    });

    if (window.smartRadioLayer) {
        map.removeLayer(window.smartRadioLayer);
        window.smartRadioLayer = null;
    }

    const meterScale = window.meterScale || 1;
    const radiusPx = 150 * meterScale; 
    const exclusionPx = 400 * meterScale;

    function getDistance(p1, p2) {
        const dx = p1.lng - p2.lng;
        const dy = p1.lat - p2.lat;
        return Math.sqrt(dx * dx + dy * dy);
    }

    const orphanedDeployables = allDeployables.filter(depLatLng => {
        for (let i = 0; i < knownRadios.length; i++) {
            if (getDistance(depLatLng, knownRadios[i]) <= radiusPx) {
                return false; 
            }
        }
        return true; 
    });

    if (orphanedDeployables.length < 2) return; 

    function createEuclideanCircle(latlng, radius, steps = 64) {
        const coords = [];
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            coords.push([
                latlng.lng + Math.cos(angle) * radius, 
                latlng.lat + Math.sin(angle) * radius
            ]);
        }
        coords.push(coords[0]); 
        return turf.polygon([coords]);
    }

    const circles = orphanedDeployables.map(latlng => createEuclideanCircle(latlng, radiusPx));
    const overlaps = [];

    for (let i = 0; i < circles.length; i++) {
        for (let j = i + 1; j < circles.length; j++) {
            const intersection = turf.intersect(circles[i], circles[j]);
            if (intersection) overlaps.push(intersection);
        }
    }

    if (overlaps.length === 0) return;

    const finalZones = [];
    overlaps.forEach(poly => {
        let currentPoly = poly;
        knownRadios.forEach(latlng => {
            const exclPoly = createEuclideanCircle(latlng, exclusionPx);
            if (currentPoly) currentPoly = turf.difference(currentPoly, exclPoly);
        });
        if (currentPoly) finalZones.push(currentPoly);
    });

    if (finalZones.length === 0) return;

    const collection = turf.featureCollection(finalZones);
    window.smartRadioLayer = L.geoJSON(collection, {
        pane: 'zonePane',
        style: { color: '#9c27b0', fillColor: '#9c27b0', fillOpacity: 0.25, weight: 2, dashArray: '4, 6', interactive: false, className: 'smart-radio-zone' },
        onEachFeature: function (feature, layer) {
            layer.options.pmIgnore = true;
            layer.options.snapIgnore = true;
        }
    }).addTo(map);
};

// ==========================================
// --- 2. RADIAL MENU ENGINE ---
// ==========================================
const contextMenu = document.getElementById('squad-context-menu');
L.DomEvent.disableClickPropagation(contextMenu);

function hideContextMenu() {
    contextMenu.classList.add('hidden');
}

map.on('contextmenu', function(e) {
    if (window.suppressContextMenu) return; 

    currentContextLatLng = e.latlng; 
    const menu = document.getElementById('squad-context-menu');

    let uiX = e.originalEvent.clientX;
    let uiY = e.originalEvent.clientY;

    if (uiX > window.innerWidth / 2) menu.classList.add('edge-right');
    else menu.classList.remove('edge-right');

    if (uiY > window.innerHeight / 2) menu.classList.add('edge-bottom');
    else menu.classList.remove('edge-bottom');

    const stretchX = 280; 
    const stretchY = 250; 

    const minX = 250 + stretchX;
    let maxX = window.innerWidth - stretchX;
    const minY = 60 + stretchY;
    let maxY = window.innerHeight - stretchY;

    if (maxX < minX) maxX = minX;
    if (maxY < minY) maxY = minY;

    uiX = Math.max(minX, Math.min(uiX, maxX));
    uiY = Math.max(minY, Math.min(uiY, maxY));

    menu.style.left = uiX + 'px';
    menu.style.top = uiY + 'px';
    menu.classList.remove('hidden');
});

map.on('click', hideContextMenu);
map.on('movestart', hideContextMenu);

// --- MARKER PLACEMENT LOGIC ---
document.querySelectorAll('.context-marker-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!currentContextLatLng) return;
        
        const name = e.currentTarget.getAttribute('data-name');
        const img = e.currentTarget.getAttribute('data-img');

        const modeOverlay = document.getElementById('mode-overlay');
        const isLocalEnemyMode = modeOverlay.classList.contains('mode-enemy');

        // Use relative paths instead of require('path') to prevent silent Electron renderer crashes on the receiving end
        const customIcon = L.icon({
            iconUrl: `https://maps.tpun.online/icons/${img}`,
            iconSize: [32, 32], iconAnchor: [16, 16],
            className: `squad-tac-icon ${isLocalEnemyMode ? 'icon-enemy' : 'icon-friendly'}`
        });

        const marker = L.marker(currentContextLatLng, { 
            icon: customIcon,
            zIndexOffset: 1000,
            draggable: true, // Native drag
            isTacticalGraphic: true,
            pmIgnore: true
        }).addTo(map);
        
        // --- STEAM P2P: ASSIGN ID & BROADCAST NEW MARKERS ---
        marker.tacticalId = (window.isApplyingRemote && window.remoteTacticalId) ? window.remoteTacticalId : generateTacticalId();
        
        if (!window.isApplyingRemote) {
            ipcMenu.send('p2p-broadcast-tactical', {
                action: 'draw-marker',
                id: marker.tacticalId,
                name: name,
                img: img,
                latlng: currentContextLatLng,
                isEnemy: isLocalEnemyMode 
            });
        }
        
        marker.shape = name;
        marker.iconFileName = img;

        // --- RESTORED: LOCAL RADIUS RINGS ---
        if (name === 'FOB-Friendly' || name === 'FOB-Enemy') {
            const isFriendly = name === 'FOB-Friendly';
            const ringColor = isFriendly ? '#0066cc' : '#cc0000';
            
            marker.ringAudio = L.circle(currentContextLatLng, { radius: 30 * meterScale, color: ringColor, weight: 1, dashArray: '3, 6', fillOpacity: 0.15, interactive: false, pmIgnore: true, isTacticalGraphic: true }).addTo(map);
            marker.ringBuild = L.circle(currentContextLatLng, { radius: 150 * meterScale, color: ringColor, weight: 2, fillOpacity: 0.05, interactive: false, pmIgnore: true, isTacticalGraphic: true }).addTo(map);
            marker.ringLockout = L.circle(currentContextLatLng, { radius: 400 * meterScale, color: ringColor, weight: 2, dashArray: '10, 10', fillOpacity: 0.02, interactive: false, pmIgnore: true, isTacticalGraphic: true }).addTo(map);
        }

        if (name === 'Mortar-Friendly') {
            marker.on('click', () => {
                if (isMortarCalcActive) {
                    activeMortarPit = marker;
                    recalculateAllMortarTargets(); 
                }
            });
        }
        
        // --- NATIVE DRAG LISTENER ---
        marker.on('drag', () => {
            if (activeMortarPit === marker) recalculateAllMortarTargets();
            if (marker.ringBuild) {
                const centerPoint = marker.getLatLng(); 
                marker.ringAudio.setLatLng(centerPoint);
                marker.ringBuild.setLatLng(centerPoint);
                marker.ringLockout.setLatLng(centerPoint);
            }
        });

        marker.on('dragend', () => {
            if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();
            ipcMenu.send('p2p-broadcast-tactical', { action: 'move-marker', id: marker.tacticalId, latlng: marker.getLatLng() });
        });

        // --- RESTORED: LOCAL DELETION (Shift+Click) ---
        const destroyMarker = () => {
            map.removeLayer(marker);
            if (marker.ringBuild) {
                map.removeLayer(marker.ringAudio);
                map.removeLayer(marker.ringBuild);
                map.removeLayer(marker.ringLockout);
            }
            if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();
            
            if (!window.isApplyingRemote && marker.tacticalId) {
                ipcMenu.send('p2p-broadcast-tactical', { action: 'delete', id: marker.tacticalId });
            }
        };

        marker.on('contextmenu', (evt) => { 
            if (evt.originalEvent && evt.originalEvent.shiftKey) {
                L.DomEvent.stop(evt.originalEvent); 
                window.suppressContextMenu = true;
                setTimeout(() => { window.suppressContextMenu = false; }, 100);
                destroyMarker(); 
            }
        });

        hideContextMenu(); 
        if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();
    });
});

// Drawn Shapes Logic (Frontlines, Arrows, Zones)
document.querySelectorAll('.context-draw-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        map.pm.disableDraw(); 
        if (typeof lockViewshedForDrawing === 'function') lockViewshedForDrawing();

        const styleType = e.currentTarget.getAttribute('data-style');
        let pathOptions = {};
        let drawShape = 'Line'; 

        if (styleType === 'frontline-friendly') pathOptions = { color: '#ffcc00', weight: 2, opacity: 0.5 };
        else if (styleType === 'frontline-enemy') pathOptions = { color: '#ff0000', weight: 2, opacity: 0.5 };
        else if (styleType === 'movement-unlabeled' || styleType === 'movement-squad') {
            const isFriendly = activeTeamMode === 'friendly';
            const moveColor = isFriendly ? '#189b18' : '#cc0000'; 
            
            activeSquadNum = styleType === 'movement-squad' ? e.currentTarget.getAttribute('data-squad') : null; 
            activeLineTool = isFriendly ? 'movement-friendly' : 'movement-enemy'; 
            pathOptions = { color: moveColor, weight: 3, opacity: 1 };
        }
        else if (styleType === 'zone-friendly') { drawShape = 'Polygon'; pathOptions = { pane: 'zonePane', color: '#0066cc', fillColor: '#0066cc', fillOpacity: 0.35, weight: 2, dashArray: '' }; }
        else if (styleType === 'zone-enemy') { drawShape = 'Polygon'; pathOptions = { pane: 'zonePane', color: '#cc0000', fillColor: '#cc0000', fillOpacity: 0.35, weight: 2, dashArray: '' }; }
        else if (styleType === 'zone-contested') { drawShape = 'Polygon'; pathOptions = { pane: 'zonePane', color: '#e68a00', fillColor: '#e68a00', fillOpacity: 0.35, weight: 2, dashArray: '' }; }
        else if (styleType === 'zone-nofly') { 
            drawShape = 'Polygon'; 
            pathOptions = { pane: 'zonePane', color: '#000000', weight: 3, dashArray: '10, 10', className: 'nofly-pattern-css' }; 
        }

        if (!styleType.startsWith('movement')) activeLineTool = styleType; 
        pathOptions.snapIgnore = true;

        map.pm.enableDraw(drawShape, {
            snappable: false,
            continueDrawing: false,
            pathOptions: pathOptions, templineStyle: pathOptions, hintlineStyle: pathOptions 
        });

        hideContextMenu(); 
    });
});

// ==========================================
// --- STEAM P2P: INCOMING PACKET HANDLER ---
// ==========================================
ipcMenu.on('p2p-receive-tactical', (event, payload) => {
    window.isApplyingRemote = true; // Lock out the broadcast events

    try {
        if (payload.action === 'delete') {
            map.eachLayer(layer => {
                if (layer.tacticalId === payload.id) {
                    if (layer.myDecorator) map.removeLayer(layer.myDecorator);
                    if (layer.myBadge) map.removeLayer(layer.myBadge);
                    if (layer.ringBuild) {
                        map.removeLayer(layer.ringAudio);
                        map.removeLayer(layer.ringBuild);
                        map.removeLayer(layer.ringLockout);
                    }
                    map.removeLayer(layer);
                }
            });
            if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();
        }
        else if (payload.action === 'update-shape') {
            map.eachLayer(layer => {
                if (layer.tacticalId === payload.id && layer.pm) {
                    const newCoords = L.geoJSON(payload.geojson).getLayers()[0].getLatLngs();
                    layer.setLatLngs(newCoords);
                    if (layer.myDecorator) layer.myDecorator.setPaths(newCoords);
                    if (layer.myBadge) layer.myBadge.setLatLng(newCoords[0]);
                }
            });
        }
        else if (payload.action === 'move-marker') {
            map.eachLayer(layer => {
                if (layer.tacticalId === payload.id && layer.setLatLng) {
                    layer.setLatLng(payload.latlng);
                    if (layer.ringBuild) {
                        layer.ringAudio.setLatLng(payload.latlng);
                        layer.ringBuild.setLatLng(payload.latlng);
                        layer.ringLockout.setLatLng(payload.latlng);
                    }
                    if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();
                }
            });
        }
        else if (payload.action === 'draw-shape') {
            const importedLayer = L.geoJSON(payload.geojson).getLayers()[0];
            importedLayer.tacticalId = payload.id;
            
            let pathOptions = {};
            if (payload.styleType === 'frontline-friendly') pathOptions = { color: '#ffcc00', weight: 2, opacity: 0.5 };
            else if (payload.styleType === 'frontline-enemy') pathOptions = { color: '#ff0000', weight: 2, opacity: 0.5 };
            else if (payload.styleType === 'movement-friendly') pathOptions = { color: '#189b18', weight: 3, opacity: 1 };
            else if (payload.styleType === 'movement-enemy') pathOptions = { color: '#cc0000', weight: 3, opacity: 1 };
            else if (payload.styleType === 'zone-friendly') pathOptions = { pane: 'zonePane', color: '#0066cc', fillColor: '#0066cc', fillOpacity: 0.35, weight: 2 };
            else if (payload.styleType === 'zone-enemy') pathOptions = { pane: 'zonePane', color: '#cc0000', fillColor: '#cc0000', fillOpacity: 0.35, weight: 2 };
            else if (payload.styleType === 'zone-contested') pathOptions = { pane: 'zonePane', color: '#e68a00', fillColor: '#e68a00', fillOpacity: 0.35, weight: 2 };
            else if (payload.styleType === 'zone-nofly') pathOptions = { pane: 'zonePane', color: '#000000', weight: 3, dashArray: '10, 10', className: 'nofly-pattern-css' };

            importedLayer.setStyle(pathOptions);
            importedLayer.options.snapIgnore = true;
            importedLayer.addTo(map);
            
            const cacheLineTool = activeLineTool;
            const cacheSquadNum = activeSquadNum; 
            
            activeLineTool = payload.styleType;
            activeSquadNum = payload.squadNum || null; 
            
            const shapeType = payload.styleType.startsWith('zone') ? 'Polygon' : 'Line';
            map.fire('pm:create', { shape: shapeType, layer: importedLayer }); 
            
            activeLineTool = cacheLineTool;
            activeSquadNum = cacheSquadNum; 
        }
        else if (payload.action === 'draw-marker') {
            // Use relative paths instead of require('path') to prevent silent Electron renderer crashes
            const customIcon = L.icon({
                iconUrl: `https://maps.tpun.online/icons/${payload.img}`,
                iconSize: [32, 32], iconAnchor: [16, 16],
                className: `squad-tac-icon ${payload.isEnemy ? 'icon-enemy' : 'icon-friendly'}`
            });

            const marker = L.marker(payload.latlng, {
                icon: customIcon,
                zIndexOffset: 1000,
                draggable: true, 
                isTacticalGraphic: true,
                pmIgnore: true
            }).addTo(map);

            marker.tacticalId = payload.id;
            marker.shape = payload.name;
            marker.iconFileName = payload.img;
            
            if (payload.name === 'FOB-Friendly' || payload.name === 'FOB-Enemy') {
                const ringColor = payload.name === 'FOB-Friendly' ? '#0066cc' : '#cc0000';
                marker.ringAudio = L.circle(payload.latlng, { radius: 30 * meterScale, color: ringColor, weight: 1, dashArray: '3, 6', fillOpacity: 0.15, interactive: false, pmIgnore: true, isTacticalGraphic: true }).addTo(map);
                marker.ringBuild = L.circle(payload.latlng, { radius: 150 * meterScale, color: ringColor, weight: 2, fillOpacity: 0.05, interactive: false, pmIgnore: true, isTacticalGraphic: true }).addTo(map);
                marker.ringLockout = L.circle(payload.latlng, { radius: 400 * meterScale, color: ringColor, weight: 2, dashArray: '10, 10', fillOpacity: 0.02, interactive: false, pmIgnore: true, isTacticalGraphic: true }).addTo(map);
            }

            marker.on('contextmenu', (evt) => {
                if (evt.originalEvent && evt.originalEvent.shiftKey) {
                    L.DomEvent.stop(evt.originalEvent);
                    map.removeLayer(marker);
                    if (marker.ringBuild) { map.removeLayer(marker.ringAudio); map.removeLayer(marker.ringBuild); map.removeLayer(marker.ringLockout); }
                    ipcMenu.send('p2p-broadcast-tactical', { action: 'delete', id: marker.tacticalId });
                }
            });

            marker.on('drag', () => {
                if (marker.ringBuild) {
                    const centerPoint = marker.getLatLng(); 
                    marker.ringAudio.setLatLng(centerPoint);
                    marker.ringBuild.setLatLng(centerPoint);
                    marker.ringLockout.setLatLng(centerPoint);
                }
            });

            marker.on('dragend', () => {
                if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();
                ipcMenu.send('p2p-broadcast-tactical', { action: 'move-marker', id: marker.tacticalId, latlng: marker.getLatLng() });
            });

            if (typeof updateRadioTriangulation === 'function') updateRadioTriangulation();
        }
    } catch (e) {
        console.error("Failed to parse remote tactical data:", e);
    }

    window.isApplyingRemote = false; 
});

// ==========================================
// --- UI BUTTON LISTENERS (Settings Menu) ---
// ==========================================
document.getElementById('btn-host-lobby')?.addEventListener('click', async () => {
    console.log("[Tactical Menu] Attempting to host lobby...");
    const hostBtn = document.getElementById('btn-host-lobby');
    hostBtn.innerText = "⏳ Initializing Lobby...";

    const result = await ipcMenu.invoke('steam-host-lobby');
    
    if (result.success) {
        hostBtn.innerText = `🌐 Lobby Active (Host)`;
        hostBtn.style.background = '#4caf50'; 
        hostBtn.style.pointerEvents = 'none'; 
        
        const inviteBtn = document.getElementById('btn-invite-friends');
        inviteBtn.style.display = 'block';
        inviteBtn.innerText = '📋 Copy Steam Invite Link';
        
        const inviteUrl = `steam://joinlobby/480/${result.lobbyId}/${result.hostId}`;
        
        inviteBtn.addEventListener('click', () => {
            const { clipboard } = require('electron');
            clipboard.writeText(inviteUrl);
            
            inviteBtn.innerText = '✅ Copied to Clipboard!';
            inviteBtn.style.background = '#218838';
            
            setTimeout(() => { 
                inviteBtn.innerText = '📋 Copy Steam Invite Link'; 
                inviteBtn.style.background = '#28a745'; 
            }, 2000);
        });

        document.getElementById('lobby-status-container').style.display = 'block';
    } else {
        hostBtn.innerText = "❌ Hosting Failed";
        console.error("Steamworks Lobby Error:", result.error);
    }
});