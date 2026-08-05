// ==========================================
// --- SQUAD LAYER ENGINE (layer-engine.js) ---
// ==========================================

const mapLayerGroup = L.featureGroup().addTo(map);

let currentMapId = null;
let activeLayerData = null;
let manualClicks = []; // Tracks strictly what the user manually clicked
let manualExcludes = []; // Tracks explicitly eliminated flags (Right-Clicks)
let raasSelectedPath = []; // Exported array for backend telemetry
let isLayerOverlayVisible = true;

// --- TOGGLE API FOR SIDEBAR ---
window.toggleLayerOverlay = function() {
    isLayerOverlayVisible = !isLayerOverlayVisible;
    if (isLayerOverlayVisible) {
        map.addLayer(mapLayerGroup);
        if (window.laneLegendControl) {
            window.laneLegendControl.addTo(map);
        }
    } else {
        map.removeLayer(mapLayerGroup);
        if (window.laneLegendControl) {
            map.removeControl(window.laneLegendControl);
        }
    }
    return isLayerOverlayVisible;
};

// --- Coordinate Converter ---
function unrealToLatLng(ueX, ueY) {
    if (!window.currentMapData || !window.currentMapData.metadata) return [0, 0];

    const meta = window.currentMapData.metadata;
    const mapSizePixels = Math.abs(meta.mapExtent[2] !== undefined ? meta.mapExtent[2] : meta.mapExtent[1]);
    const ueMetersX = ueX / 100;
    const ueMetersY = ueY / 100;

    const physX = meta.physicalSizeMetersX || meta.physicalSizeMeters;
    const physY = meta.physicalSizeMetersY || meta.physicalSizeMeters;

    const scaleX = mapSizePixels / physX;
    const scaleY = mapSizePixels / physY;

    const offsetX = meta.ueOffsetX !== undefined ? meta.ueOffsetX : 0;
    const offsetY = meta.ueOffsetY !== undefined ? meta.ueOffsetY : 0;

    const correctedX = ueMetersX + offsetX;
    const correctedY = ueMetersY + offsetY;

    const lat = -(mapSizePixels / 2) - (correctedY * scaleY);
    const lng = (mapSizePixels / 2) + (correctedX * scaleX);

    return [lat, lng];
}

// --- UNIVERSAL DATA CLEANER ---
function mergeDuplicateFlags(flags) {
    if (!flags || !Array.isArray(flags)) return [];
    const mergedFlags = [];

    flags.forEach(flag => {
        if ((flag.lane === "Main") || (flag.name && flag.name.toLowerCase().includes("main"))) {
            mergedFlags.push(flag);
            return;
        }

        const baseName = flag.name.replace(/\s*\d+$/, '').trim();
        const phaseOrder = flag.order !== undefined ? flag.order : 'none';
        let merged = false;

        for (let i = 0; i < mergedFlags.length; i++) {
            const existing = mergedFlags[i];
            if (existing.name === baseName && existing.order === phaseOrder) {
                const dx = existing.x - flag.x;
                const dy = existing.y - flag.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                if (dist < 30000) {
                    if (flag.lane && existing.lane) {
                        let l1 = existing.lane.split(',').map(s => s.trim());
                        let l2 = flag.lane.split(',').map(s => s.trim());
                        let combined = Array.from(new Set([...l1, ...l2]));
                        existing.lane = (combined.includes("Any") || combined.includes("ANY")) ? "Any" : combined.join(',');
                    }
                    existing.x = (existing.x + flag.x) / 2;
                    existing.y = (existing.y + flag.y) / 2;
                    merged = true;
                    break;
                }
            }
        }

        if (!merged) {
            const flagCopy = JSON.parse(JSON.stringify(flag));
            flagCopy.name = baseName;
            mergedFlags.push(flagCopy);
        }
    });

    return mergedFlags;
}

// --- Refined Junk Filter ---
function getValidFlags(flags) {
    if (!flags) return [];
    const cleanedFlags = flags.filter(f => {
        if (!f.name) return false;
        const lowerName = f.name.trim().toLowerCase();
        if (lowerName.startsWith("sm_") || lowerName.includes("flag_") ||
            lowerName.includes("destroyableobjective") || lowerName.includes("objectivespawnlocation") ||
            lowerName.startsWith("flagpole_") || lowerName.startsWith("caf") || lowerName.startsWith("horizontal")) {
            return false;
        }
        return true;
    });

    const realFlags = cleanedFlags.filter(f => !f.name.toLowerCase().includes("capture zone"));
    const finalFlags = [];

    cleanedFlags.forEach(f => {
        if (f.name.toLowerCase().includes("capture zone")) {
            let closestReal = null;
            let minDist = Infinity;
            realFlags.forEach(rf => {
                const dist = Math.sqrt(Math.pow(f.x - rf.x, 2) + Math.pow(f.y - rf.y, 2));
                if (dist < minDist) {
                    minDist = dist;
                    closestReal = rf;
                }
            });

            if (closestReal && minDist < 30000) {
                return;
            } else {
                f.name = "Unnamed Objective";
                finalFlags.push(f);
            }
        } else {
            finalFlags.push(f);
        }
    });

    return finalFlags;
}

// ==========================================
// --- 1. DYNAMIC DROPDOWN & FILE READING ---
// ==========================================
window.updateLayerDropdown = function(mapId, layerNamesArray) {
    currentMapId = mapId;
    const select = document.getElementById('squad-layer-select');
    select.innerHTML = '<option value="none">-- Select Layer --</option>';
    
    layerNamesArray.forEach(layerName => {
        const option = document.createElement('option');
        option.value = layerName;
        option.innerText = layerName;
        select.appendChild(option);
    });

    mapLayerGroup.clearLayers();
    activeLayerData = null;
    manualClicks = [];
    manualExcludes = [];
    raasSelectedPath = [];
};

window.loadSquadLayer = async function(layerName) {
    if (layerName === 'none') {
        mapLayerGroup.clearLayers();
        return;
    }

    try {
        const fs = require('fs');
        const path = require('path');
        
        // --- 1. ASAR CASE-SENSITIVITY SCANNER ---
        const mapsDir = path.join(__dirname, 'assets', 'maps');
        const allFolders = fs.readdirSync(mapsDir);
        
        let exactFolderName = null;
        for (const item of allFolders) {
            // Find the physical folder name regardless of how currentMapId is capitalized
            if (item.toLowerCase() === currentMapId.toLowerCase()) {
                exactFolderName = item;
                break;
            }
        }

        if (!exactFolderName) {
            throw new Error(`Could not find map folder for ${currentMapId} in ASAR.`);
        }

        // 2. Build the path using the strictly correct folder name.
        // (layerName is already strictly capitalized from the dropdown!)
        const layerPath = path.join(mapsDir, exactFolderName, `${layerName}.json`);
        
        if (!fs.existsSync(layerPath)) throw new Error(`Layer file not found at: ${layerPath}`);

        activeLayerData = JSON.parse(fs.readFileSync(layerPath, 'utf8'));
        if (activeLayerData && activeLayerData.flags) {
            activeLayerData.flags = mergeDuplicateFlags(activeLayerData.flags);
        }

        manualClicks = [];
        manualExcludes = [];
        raasSelectedPath = [];
        renderCurrentLayerState();
    } catch (err) {
        console.error("🚨 Error loading layer:", err);
        mapLayerGroup.clearLayers();
    }
};

document.getElementById('squad-layer-select').addEventListener('change', (e) => {
    if (window.loadSquadLayer) window.loadSquadLayer(e.target.value);
});

// ==========================================
// --- 2. RENDERING LOGIC ---
// ==========================================
function renderCurrentLayerState() {
    mapLayerGroup.clearLayers();
    if (!activeLayerData || !activeLayerData.flags) return;

    const isTeam1 = (window.playerTeamIndex === 1);
    const team1Color = isTeam1 ? '#0066cc' : '#cc0000';
    const team2Color = isTeam1 ? '#cc0000' : '#0066cc';

    const team1Main = activeLayerData.flags.find(f => f.order === 0 || f.name.includes("Team 1"));
    const team2Main = activeLayerData.flags.find(f => f.order === 100 || f.name.includes("Team 2"));
    let objectives = activeLayerData.flags.filter(f => f.lane !== 'Main' && f.order !== 0 && f.order !== 100 && !f.name.includes("Main"));

    objectives = getValidFlags(objectives);

    if (team1Main) drawMainBase(team1Main, team1Color);
    if (team2Main) drawMainBase(team2Main, team2Color);

    const layerNameString = (activeLayerData.layer_name || "").toUpperCase();

    if (layerNameString.includes("INSURGENCY")) {
        renderInsurgencyLayer();
    } else if (layerNameString.includes("RAAS") || layerNameString.includes("INVASION")) {
        renderRAASLayer(objectives, team1Main, team2Main);
    } else if (layerNameString.includes("AAS") || layerNameString.includes("SKIRMISH") || layerNameString.includes("SEED")) {
        renderAASLayer(objectives, team1Main, team2Main);
    } else {
        renderGenericLayer(objectives);
    }
}

function renderInsurgencyLayer() {
    if (activeLayerData.caches) {
        activeLayerData.caches.forEach(cache => drawCacheMarker(cache, unrealToLatLng(cache.x, cache.y)));
    }
}

function renderAASLayer(objectives, team1Main, team2Main) {
    const coordsList = [];
    if (team1Main) coordsList.push(unrealToLatLng(team1Main.x, team1Main.y));
    
    objectives.sort((a, b) => a.order - b.order).forEach(flag => {
        if (flag.order === -1 || flag.isPlaceholder) return;
        const latLng = unrealToLatLng(flag.x, flag.y);
        drawFlagMarker(flag, 'locked', false);
        coordsList.push(latLng);
    });

    if (team2Main) coordsList.push(unrealToLatLng(team2Main.x, team2Main.y));
    
    if (coordsList.length > 1) {
        L.polyline(coordsList, { color: '#ffffff', weight: 3, opacity: 0.8, interactive: false, pmIgnore: true }).addTo(mapLayerGroup);
    }
}

// --- Lane Matching ---
function parseLanes(laneStr) {
    if (!laneStr) return ["ANY"];
    let s = String(laneStr).toUpperCase().replace(/LANE/g, '').trim();
    if (s.includes(',') || s.includes(' ')) return s.split(/[, ]+/).filter(x => x);
    if (s.length > 1 && s.length <= 3 && (/^[A-Z]+$/.test(s) || /^[0-9]+$/.test(s))) return s.split('');
    return [s];
}

function checkLaneMatch(lane1, lane2) {
    let l1 = String(lane1 || "ANY").toUpperCase().trim();
    let l2 = String(lane2 || "ANY").toUpperCase().trim();
    if (l1 === l2) return true;

    let tokens1 = parseLanes(lane1);
    let tokens2 = parseLanes(lane2);
    if (tokens1.includes('ANY') || tokens2.includes('ANY') || tokens1.includes('UNKNOWN') || tokens2.includes('UNKNOWN')) return true;
    
    for (let t1 of tokens1) {
        if (tokens2.includes(t1)) return true;
    }
    return false;
}

// --- RAAS & INVASION (Data-Normalized Path Engine) ---
function renderRAASLayer(objectives, team1Main, team2Main) {
    // Clear old legend on render
    if (window.laneLegendControl) {
        map.removeControl(window.laneLegendControl);
        window.laneLegendControl = null;
    }

    if (objectives.length === 0) return;

    // 1. Flatten phases and extract specific lane tokens
    const allPhases = objectives.flatMap(f => f.phases || []);
    if (allPhases.length === 0) return;

    const orders = [...new Set(allPhases.map(p => p.order))].sort((a, b) => a - b);
    const maxExpectedLength = orders.length;

    const laneTokens = new Set();
    allPhases.forEach(p => {
        let s = String(p.lane).toUpperCase().replace(/LANE/g, '').trim();
        let tokens = s.split(/[, ]+/).filter(x => x);
        tokens.forEach(t => { if (t !== 'ANY' && t !== 'UNKNOWN') laneTokens.add(t); });
    });
    if (laneTokens.size === 0) laneTokens.add('ANY');

    let allPaths = [];

    // 2. Build strict paths & TAG THEM with their macro-lane
    laneTokens.forEach(lane => {
        let currentPaths = [[]];

        const flagSignatures = {};
        objectives.forEach(f => {
            if (f.phases) {
                flagSignatures[f.name] = f.phases
                    .filter(p => p.lane.toUpperCase().includes(lane) || p.lane.toUpperCase() === 'ANY')
                    .map(p => p.order).sort((a, b) => a - b).join(',');
            }
        });

        for (let order of orders) {
            const validLocations = objectives.filter(f =>
                f.phases && f.phases.some(p => p.order === order && (p.lane.toUpperCase().includes(lane) || p.lane.toUpperCase() === 'ANY'))
            );

            let nextPaths = [];
            currentPaths.forEach(path => {
                validLocations.forEach(flag => {
                    if (path.length > 0) {
                        const lastFlag = path[path.length - 1];
                        if (lastFlag.name === flag.name) return; 
                        
                        const newFlagSig = flagSignatures[flag.name];
                        const hasSibling = path.some(existingFlag => flagSignatures[existingFlag.name] === newFlagSig);
                        if (hasSibling && newFlagSig !== "") return; 
                    }
                    nextPaths.push([...path, flag]);
                });
            });
            currentPaths = nextPaths;
        }
        
        currentPaths.forEach(p => p._laneTag = lane);
        allPaths.push(...currentPaths);
    });

    // 3. STRICT LENGTH FILTER
    let validPaths = allPaths.filter(path => path.length === maxExpectedLength);

    // ==========================================
    // 4. SEQUENTIAL INTENT FILTER
    // ==========================================
    function filterPathsByUserInput(pathsToFilter, clicks, excludes) {
        const isTeam1 = (window.playerTeamIndex === 1);

        // PASS 1: Strict Inclusions & Exclusions (Creates the Sub-Pool)
        const baseFiltered = pathsToFilter.filter(path => {
            const hasNoExcludes = excludes.every(excludeName => !path.some(f => f.name === excludeName));
            if (!hasNoExcludes) return false;

            const hasAllClicks = clicks.every(clickName => path.some(f => f.name === clickName));
            if (!hasAllClicks) return false;

            return true;
        });

        // PASS 2: Sequential Integrity on the Surviving Sub-Pool
        return baseFiltered.filter(path => {
            if (clicks.length === 0) return true;

            if (isTeam1) {
                const t1HomeEnd = Math.ceil(path.length / 2);
                let furthestHomeClickIndex = -1;
                for (let i = t1HomeEnd - 1; i >= 0; i--) {
                    if (clicks.includes(path[i].name)) {
                        furthestHomeClickIndex = i;
                        break;
                    }
                }

                if (furthestHomeClickIndex !== -1) {
                    for (let i = 0; i <= furthestHomeClickIndex; i++) {
                        if (!clicks.includes(path[i].name)) {
                            // SCOPE FIX: Check bottlenecks inside the local `baseFiltered` pool
                            const uniqueFlagsAtIndex = new Set(baseFiltered.map(p => p[i].name));
                            if (uniqueFlagsAtIndex.size > 1) {
                                return false; // Illegal skip, kill the path
                            }
                        }
                    }
                }
            } else {
                const t2HomeStart = Math.floor(path.length / 2);
                let furthestHomeClickIndex = -1;
                for (let i = t2HomeStart; i < path.length; i++) {
                    if (clicks.includes(path[i].name)) {
                        furthestHomeClickIndex = i;
                        break; 
                    }
                }

                if (furthestHomeClickIndex !== -1) {
                    for (let i = path.length - 1; i >= furthestHomeClickIndex; i--) {
                        if (!clicks.includes(path[i].name)) {
                            // SCOPE FIX: Check bottlenecks inside the local `baseFiltered` pool
                            const uniqueFlagsAtIndex = new Set(baseFiltered.map(p => p[i].name));
                            if (uniqueFlagsAtIndex.size > 1) {
                                return false; // Illegal skip, kill the path
                            }
                        }
                    }
                }
            }
            return true;
        });
    }

    let validPathsFiltered = filterPathsByUserInput(validPaths, manualClicks, manualExcludes);

    // ==========================================
    // 5. THE BOUNCER: Reject Invalid Clicks
    // ==========================================
    if (validPathsFiltered.length === 0 && manualClicks.length > 0) {
        manualClicks.pop(); 
        validPathsFiltered = filterPathsByUserInput(validPaths, manualClicks, manualExcludes);
    }

    if (validPathsFiltered.length === 0 && manualExcludes.length > 0) {
        manualExcludes = [];
        validPathsFiltered = filterPathsByUserInput(validPaths, manualClicks, manualExcludes);
    }

    validPaths = validPathsFiltered;

    // ==========================================
    // 6. PURE MATHEMATICAL LOCKING
    // ==========================================
    const drawableFlags = new Set();
    validPaths.forEach(path => path.forEach(f => drawableFlags.add(f.name)));

    const manualLockNames = new Set(manualClicks);
    const autoLockNames = new Set();
    
    if (validPaths.length > 0) {
        drawableFlags.forEach(flagName => {
            const isGuaranteed = validPaths.every(path => path.some(f => f.name === flagName));
            // Only add to auto-locks if it's guaranteed AND the user hasn't manually clicked it
            if (isGuaranteed && !manualLockNames.has(flagName)) {
                autoLockNames.add(flagName);
            }
        });
    }

    function getLockType(f) {
        if (manualLockNames.has(f.name)) return 'manual';
        if (autoLockNames.has(f.name)) return 'auto';
        return false;
    }
    
    raasSelectedPath = Array.from(drawableFlags).map(name => objectives.find(o => o.name === name)).filter(f => getLockType(f) !== false);

    // ==========================================
    // 7. BUILD LANE LEGEND
    // ==========================================
    const totalValidPaths = validPaths.length;
    if (totalValidPaths > 0 && laneTokens.size > 1 && !laneTokens.has('ANY')) {
        window.laneLegendControl = L.control({ position: 'bottomright' });
        window.laneLegendControl.onAdd = function () {
            const div = L.DomUtil.create('div', 'squad-lane-legend');
            
            div.style.marginBottom = '53px'; 
            div.style.marginRight = '10px';
            
            div.style.pointerEvents = 'none'; 
            
            div.style.backgroundColor = 'rgba(15, 15, 15, 0.9)';
            div.style.color = 'white';
            div.style.padding = '12px';
            div.style.borderRadius = '6px';
            div.style.border = '1px solid rgba(255,255,255,0.2)';
            div.style.fontFamily = 'monospace';
            div.style.boxShadow = '0px 4px 10px rgba(0,0,0,0.8)';
            
            let html = `<h4 style="margin: 0 0 8px 0; font-size: 14px; text-align: center; border-bottom: 1px solid #555; padding-bottom: 4px;">Lane Probability</h4>`;
            html += `<table style="width: 100%; font-size: 13px; border-collapse: collapse;">`;
            
            Array.from(laneTokens).sort().forEach(lane => {
                const count = validPaths.filter(p => p._laneTag === lane).length;
                const prob = Math.round((count / totalValidPaths) * 100);
                const color = getLaneColor(lane);
                const opacity = prob === 0 ? '0.4' : '1';
                
                html += `<tr style="opacity: ${opacity};">
                    <td style="padding: 4px 12px 4px 0;"><span style="display:inline-block; width:12px; height:12px; background:${color}; border-radius:50%; margin-right:8px; vertical-align:middle; border: 1px solid rgba(255,255,255,0.5);"></span>Lane ${lane}</td>
                    <td style="padding: 4px 0; text-align: right; font-weight: bold; color: ${prob > 0 ? '#fff' : '#888'};">${prob}%</td>
                </tr>`;
            });
            html += `</table>`;
            div.innerHTML = html;
            
            return div;
        };
        
        if (isLayerOverlayVisible) {
            window.laneLegendControl.addTo(map);
        }
    }

    // ==========================================
    // 8. DRAW DONUT MARKERS
    // ==========================================
    objectives.forEach(f => {
        if (!drawableFlags.has(f.name)) return;

        const pathsWithThisFlag = validPaths.filter(path => path.some(pf => pf.name === f.name));
        const probability = totalValidPaths > 0 ? Math.round((pathsWithThisFlag.length / totalValidPaths) * 100) : 0;

        const activePhasesMap = new Map(); 
        pathsWithThisFlag.forEach(path => {
            const index = path.findIndex(pf => pf.name === f.name);
            if (index !== -1) {
                const activeOrder = orders[index];
                const pathLane = path._laneTag; 
                
                if (f.phases) {
                    f.phases.forEach(p => {
                        let l = String(p.lane).toUpperCase().replace(/LANE/g, '').trim();
                        if (p.order === activeOrder && (l === pathLane || l === 'ANY')) {
                            let displayOrder = activeOrder;
                            if (window.playerTeamIndex === 2) {
                                displayOrder = orders.length - index; 
                            }
                            activePhasesMap.set(`${displayOrder}_${l}`, { order: displayOrder, lane: l });
                        }
                    });
                }
            }
        });

        const activePhases = Array.from(activePhasesMap.values());
        const lockType = getLockType(f); // Get specific string: 'manual', 'auto', or false
        
        const marker = drawDonutFlagMarker(f, activePhases, probability, lockType);

        marker.on('click', () => {
            if (manualClicks.includes(f.name)) {
                manualClicks = manualClicks.filter(c => c !== f.name);
            } else {
                manualClicks.push(f.name);
            }
            renderCurrentLayerState();
        });

        marker.on('contextmenu', (e) => {
            manualExcludes.push(f.name);
            manualClicks = manualClicks.filter(c => c !== f.name);
            renderCurrentLayerState();
        });
    });

    // 9. Draw Path Lines
    const drawnLines = new Set();
    validPaths.forEach(path => {
        for (let i = 0; i < path.length - 1; i++) {
            const f1 = path[i];
            const f2 = path[i+1];
            const lineKey = `${f1.name}_${f2.name}`;
            
            if (!drawnLines.has(lineKey)) {
                drawnLines.add(lineKey);
                // Line is thick if both ends have ANY kind of lock
                const isThick = getLockType(f1) !== false && getLockType(f2) !== false;
                L.polyline([unrealToLatLng(f1.x, f1.y), unrealToLatLng(f2.x, f2.y)], {
                    color: isThick ? '#ffffff' : '#a3a3a3', 
                    weight: isThick ? 4 : 2, 
                    opacity: isThick ? 1 : 0.4, 
                    dashArray: isThick ? null : '5, 5', 
                    interactive: false, 
                    pmIgnore: true
                }).addTo(mapLayerGroup);
            }
        }
    });

    // 10. Connect Main Bases
    if (team1Main) {
        const drawnConnections = new Set();
        validPaths.forEach(path => {
            if (path.length === 0) return;
            const firstFlag = path[0]; 
            if (!drawnConnections.has(firstFlag.name)) {
                drawnConnections.add(firstFlag.name);
                const isThick = getLockType(firstFlag) !== false;
                L.polyline([unrealToLatLng(team1Main.x, team1Main.y), unrealToLatLng(firstFlag.x, firstFlag.y)], {
                    color: isThick ? '#ffffff' : '#a3a3a3', weight: isThick ? 4 : 2, opacity: isThick ? 1 : 0.4, 
                    dashArray: isThick ? null : '5, 5', interactive: false, pmIgnore: true
                }).addTo(mapLayerGroup);
            }
        });
    }

    if (team2Main) {
        const drawnConnections = new Set();
        validPaths.forEach(path => {
            if (path.length === 0) return;
            const lastFlag = path[path.length - 1]; 
            if (!drawnConnections.has(lastFlag.name)) {
                drawnConnections.add(lastFlag.name);
                const isThick = getLockType(lastFlag) !== false;
                L.polyline([unrealToLatLng(team2Main.x, team2Main.y), unrealToLatLng(lastFlag.x, lastFlag.y)], {
                    color: isThick ? '#ffffff' : '#a3a3a3', weight: isThick ? 4 : 2, opacity: isThick ? 1 : 0.4, 
                    dashArray: isThick ? null : '5, 5', interactive: false, pmIgnore: true
                }).addTo(mapLayerGroup);
            }
        });
    }
}

// --- GENERIC ---
function renderGenericLayer(objectives) {
    objectives.forEach(flag => drawFlagMarker(flag, 'locked', false));
}

// --- UI Generators ---
function drawMainBase(mainObj, bgColor) {
    if (!mainObj) return;
    const latLng = unrealToLatLng(mainObj.x, mainObj.y);

    const radiusMeters = mainObj.exclusionRadius || 400;
    const radiusPixels = radiusMeters * (window.meterScale || 1);

    L.circle(latLng, {
        radius: radiusPixels, 
        color: bgColor, 
        fillColor: bgColor, 
        fillOpacity: 0.15, 
        weight: 2, 
        dashArray: '6, 6', 
        interactive: false, 
        pmIgnore: true
    }).addTo(mapLayerGroup);

    const mainIcon = L.divIcon({
        className: 'squad-main-base',
        html: `<div style="background-color: ${bgColor}; border: 2px solid #fff; padding: 5px; border-radius: 4px; color: white; font-weight: bold; text-align: center; box-shadow: 0 0 8px rgba(0,0,0,0.8);">${mainObj.name.split('_')[0]}</div>`,
        iconSize: [80, 30], 
        iconAnchor: [40, 15]
    });
    
    L.marker(latLng, { icon: mainIcon, interactive: false, pmIgnore: true }).addTo(mapLayerGroup);
}

// --- UI Generators ---
function drawFlagMarker(flagObj, roleClass, isInteractive, probability = null, laneLabels = "") {
    let probHtml = "";
    
    if (probability !== null) {
        // Color code based on certainty: 100% = Green, >50% = Yellow, <50% = Orange
        const color = probability === 100 ? '#4caf50' : (probability >= 50 ? '#ffeb3b' : '#ff9800');
        
        probHtml = `
        <div class="squad-flag-prob" style="position: absolute; top: 38px; left: 50%; transform: translateX(-50%); 
            background: rgba(15,15,15,0.9); color: ${color}; font-size: 11px; font-family: monospace; font-weight: bold; 
            border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 2px 6px; white-space: nowrap; 
            box-shadow: 0px 2px 4px rgba(0,0,0,0.8); z-index: 1000; pointer-events: none;">
            ${laneLabels} (${probability}%)
        </div>`;
    }

    const flagIcon = L.divIcon({
        className: `squad-flag-marker flag-${roleClass}`,
        html: `⚑<div class="squad-flag-label">${flagObj.name}</div>${probHtml}`,
        iconSize: [36, 36], 
        iconAnchor: [18, 18]
    });
    
    return L.marker(unrealToLatLng(flagObj.x, flagObj.y), { icon: flagIcon, interactive: isInteractive, pmIgnore: true }).addTo(mapLayerGroup);
}

function drawCacheMarker(cache, latlng) {
    const icon = L.divIcon({
        className: 'squad-cache',
        html: `<div style="background-color: #8e44ad; border: 2px solid #fff; border-radius: 4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; box-shadow: 0 0 5px rgba(0,0,0,0.8);">C</div>`,
        iconSize: [24, 24], 
        iconAnchor: [12, 12]
    });
    L.marker(latlng, { icon: icon, interactive: false, pmIgnore: true }).addTo(mapLayerGroup);
}

// ==========================================
// --- UI: COLOR PALETTE & LEGEND ---
// ==========================================
const LANE_COLORS = {
    'A': '#f44336',   // Red
    'B': '#2196f3',   // Blue
    'C': '#4caf50',   // Green
    'D': '#ff9800',   // Orange
    'E': '#9c27b0',   // Purple
    'F': '#00bcd4',   // Cyan
    'G': '#e91e63',   // Pink
    'H': '#ffc107',   // Amber
    'I': '#009688',   // Teal
    'J': '#3f51b5',   // Indigo
    'ANY': '#607d8b'  // Blue Grey
};

function getLaneColor(laneStr) {
    let l = String(laneStr).toUpperCase().replace(/LANE/g, '').trim();
    return LANE_COLORS[l] || '#9e9e9e'; // Default grey for unknown lanes beyond J
}

window.laneLegendControl = null; // Global reference to manage the map control

// ==========================================
// --- UI: DONUT CHART FLAG MARKER ---
// ==========================================
function drawDonutFlagMarker(flagObj, activePhases, probability, lockType) {
    const size = 44;
    const center = size / 2;
    const strokeRadius = 14; 
    const strokeWidth = 8;
    const circumference = 2 * Math.PI * strokeRadius;

    let svgContent = '';
    const sliceCount = activePhases.length;

    if (sliceCount === 0) {
        svgContent = `<circle cx="${center}" cy="${center}" r="${strokeRadius}" fill="rgba(15,15,15,0.8)" stroke="#666" stroke-width="${strokeWidth}" />`;
    } else if (sliceCount === 1) {
        const p = activePhases[0];
        const color = getLaneColor(p.lane);
        svgContent += `<circle cx="${center}" cy="${center}" r="${strokeRadius}" fill="rgba(15,15,15,0.8)" stroke="${color}" stroke-width="${strokeWidth}" />`;
        svgContent += `<text x="${center}" y="${center}" fill="#fff" font-size="11" font-family="monospace" font-weight="bold" text-anchor="middle" dominant-baseline="central">${p.order}</text>`;
    } else {
        const sliceLength = circumference / sliceCount;
        activePhases.forEach((p, i) => {
            const color = getLaneColor(p.lane);
            const offset = (circumference * 0.25) - (i * sliceLength); 
            
            svgContent += `<circle cx="${center}" cy="${center}" r="${strokeRadius}" fill="transparent" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="${sliceLength} ${circumference - sliceLength}" stroke-dashoffset="${offset}" />`;
            
            const middleAngleDeg = -90 + (i + 0.5) * (360 / sliceCount);
            const middleAngleRad = middleAngleDeg * Math.PI / 180;
            const tx = center + strokeRadius * Math.cos(middleAngleRad);
            const ty = center + strokeRadius * Math.sin(middleAngleRad);
            
            svgContent += `<text x="${tx}" y="${ty}" fill="#fff" font-size="9" font-family="monospace" font-weight="bold" text-anchor="middle" dominant-baseline="central" style="text-shadow: 1px 1px 2px #000, -1px -1px 2px #000, 0px 0px 3px #000;">${p.order}</text>`;
        });
        svgContent += `<circle cx="${center}" cy="${center}" r="${strokeRadius - strokeWidth/2}" fill="rgba(15,15,15,0.8)" />`;
    }

    const probColor = probability === 100 ? '#4caf50' : (probability >= 50 ? '#ffeb3b' : '#ff9800');
    
    // DIFFERENTIATE LOCK TYPES
    let lockIndicator = '';
    if (lockType === 'manual') {
        lockIndicator = `<div style="position:absolute; top:-5px; right:-5px; font-size:14px; z-index: 10; text-shadow: 0px 0px 4px #000;">✅</div>`;
    } else if (lockType === 'auto') {
        lockIndicator = `<div style="position:absolute; top:-5px; right:-5px; font-size:12px; z-index: 10; text-shadow: 0px 0px 4px #000;">🔒</div>`;
    }

    const html = `
        <div style="position: relative; width: ${size}px; height: ${size}px; z-index: ${probability === 100 ? 1000 : 500};">
            ${lockIndicator}
            <div style="position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 11px; color: white; background: rgba(0,0,0,0.8); padding: 2px 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); white-space: nowrap; pointer-events: none;">
                ${flagObj.name}
            </div>
            <svg width="${size}" height="${size}" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.8));">
                ${svgContent}
            </svg>
            <div style="position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%); color: ${probColor}; background: rgba(0,0,0,0.85); font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); pointer-events: none; font-family: monospace;">
                ${probability}%
            </div>
        </div>
    `;

    const icon = L.divIcon({ className: '', html: html, iconSize: [size, size], iconAnchor: [center, center] });
    return L.marker(unrealToLatLng(flagObj.x, flagObj.y), { icon: icon, interactive: true, pmIgnore: true }).addTo(mapLayerGroup);
}