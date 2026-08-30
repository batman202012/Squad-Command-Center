// ==========================================
// --- ASSET & VEHICLE TIMER LOGIC (timers.js) ---
// ==========================================

let timerDatabase = {};
let activeTimers = [];

// DOM Elements
const friendlyFaction = document.getElementById('timers-friendly-faction');
const friendlyDivision = document.getElementById('timers-friendly-division');
const enemyFaction = document.getElementById('timers-enemy-faction');
const enemyDivision = document.getElementById('timers-enemy-division');
const friendlySpawner = document.getElementById('friendly-spawner-list');
const enemyAssetSpawner = document.getElementById('enemy-asset-spawner-list');
const enemyVehicleSpawner = document.getElementById('enemy-vehicle-spawner-list');
const friendlyActive = document.getElementById('friendly-active-timers');
const enemyActive = document.getElementById('enemy-active-timers');

// Optional role selectors (default to 'attackers' if not present in DOM)
const friendlyRole = document.getElementById('timers-friendly-role') || { value: 'attackers' };
const enemyRole = document.getElementById('timers-enemy-role') || { value: 'defenders' };

// 1. Fetch JSON Data
if (typeof require !== 'undefined') {
    try {
        const fs = require('fs');
        const path = require('path');
        const dataPath = path.join(__dirname, 'assets', 'data', 'asset_timers.json');
        if (fs.existsSync(dataPath)) {
            timerDatabase = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            populateFactions();
        }
    } catch (e) {
        console.warn("Electron FS read failed, falling back to fetch...", e);
    }
}

if (!timerDatabase.factions) {
    fetch('./assets/data/asset_timers.json')
        .then(response => response.json())
        .then(data => {
            timerDatabase = data;
            populateFactions();
        })
        .catch(err => console.error("Error loading asset_timers.json", err));
}

// 2. Populate Dropdowns
function populateFactions() {
    const factions = Object.keys(timerDatabase.factions || {});
    factions.forEach(faction => {
        friendlyFaction.add(new Option(faction, faction));
        enemyFaction.add(new Option(faction, faction));
    });

    friendlyFaction.addEventListener('change', () => updateDivisions('friendly'));
    enemyFaction.addEventListener('change', () => updateDivisions('enemy'));
    friendlyDivision.addEventListener('change', renderSpawnerButtons);
    enemyDivision.addEventListener('change', renderSpawnerButtons);

    if (friendlyRole.addEventListener) friendlyRole.addEventListener('change', () => updateDivisions('friendly'));
    if (enemyRole.addEventListener) enemyRole.addEventListener('change', () => updateDivisions('enemy'));

    updateDivisions('friendly');
    updateDivisions('enemy');
}

function updateDivisions(team) {
    const factionSelect = team === 'friendly' ? friendlyFaction : enemyFaction;
    const divisionSelect = team === 'friendly' ? friendlyDivision : enemyDivision;
    
    divisionSelect.innerHTML = '';
    const selectedFaction = factionSelect.value;
    
    if (!selectedFaction || !timerDatabase.factions?.[selectedFaction]) {
        renderSpawnerButtons();
        return;
    }
    
    // Read setup keys directly from the selected faction (e.g., "USMC_LO_Motorized")
    const setups = Object.keys(timerDatabase.factions[selectedFaction] || {});
    
    setups.forEach(setupKey => {
        divisionSelect.add(new Option(setupKey, setupKey));
    });

    if (setups.length > 0) {
        divisionSelect.value = setups[0];
    }
    
    renderSpawnerButtons();
}

// 3. Factory to create smart buttons
function createSpawnerButton(name, dataObj, team, targetContainer, colorTheme) {
    const duration = typeof dataObj === 'number' ? dataObj : dataObj.duration;
    const max = dataObj.max || 1;
    const group = dataObj.group || 'none';
    
    // Normalize initial delays: can be an array [360, 900] or a single number 360
    let initialDelays = [];
    if (Array.isArray(dataObj.initial_delays)) {
        initialDelays = dataObj.initial_delays;
    } else if (Array.isArray(dataObj.initial_delay)) {
        initialDelays = dataObj.initial_delay;
    } else if (typeof dataObj.initial_delay === 'number' && dataObj.initial_delay > 0) {
        initialDelays = [dataObj.initial_delay];
    }

    const btn = document.createElement('button');
    btn.className = 'spawner-btn';
    
    btn.dataset.name = name;
    btn.dataset.team = team;
    btn.dataset.max = max;
    btn.dataset.group = group;
    btn.dataset.initialDelays = JSON.stringify(initialDelays);

    btn.style.cssText = `background: ${colorTheme}; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px; font-weight: bold; transition: opacity 0.2s; position: relative;`;
    
    // LEFT-CLICK: Standard Respawn Cooldown (Vehicle Destroyed / Asset Used)
    btn.onclick = () => startTimer(name, duration, team, max, group, false);

    targetContainer.appendChild(btn);
}

// 4. Render Specific Assets
function renderSpawnerButtons() {
    friendlySpawner.innerHTML = '';
    enemyAssetSpawner.innerHTML = '';
    enemyVehicleSpawner.innerHTML = '';

    const pFac = friendlyFaction.value;
    const pDiv = friendlyDivision.value;
    const pRole = friendlyRole.value || 'attackers';

    const eFac = enemyFaction.value;
    const eDiv = enemyDivision.value;
    const eRole = enemyRole.value || 'defenders';

    const friendlyData = timerDatabase.factions?.[pFac]?.[pDiv] || {};
    const enemyData = timerDatabase.factions?.[eFac]?.[eDiv] || {};

    if (friendlyData.command_assets) {
        Object.entries(friendlyData.command_assets).forEach(([name, dataObj]) => {
            createSpawnerButton(name, dataObj, 'friendly', friendlySpawner, '#0066cc');
        });
    }

    if (enemyData.command_assets) {
        Object.entries(enemyData.command_assets).forEach(([name, dataObj]) => {
            createSpawnerButton(name, dataObj, 'enemy', enemyAssetSpawner, '#cc0000');
        });
    }
    if (enemyData.vehicles) {
        Object.entries(enemyData.vehicles).forEach(([name, dataObj]) => {
            createSpawnerButton(name, dataObj, 'enemy', enemyVehicleSpawner, '#8b0000');
        });
    }

    updateButtonStates();
}

// 5. Start Timer with Limit Checking & Shared Group Cooldowns
function startTimer(name, durationSeconds, team, maxCount, sharedGroup, isInitial = false) {
    const now = Date.now();
    const effectiveGroup = isInitial ? 'none' : sharedGroup;

    const activeCount = activeTimers.filter(t => 
        t.team === team && t.endTime > now &&
        (t.baseName === name || (effectiveGroup !== 'none' && t.sharedGroup === effectiveGroup))
    ).length;

    if (activeCount >= maxCount) return;

    const endTime = now + (durationSeconds * 1000);
    const timerId = Date.now().toString() + Math.random().toString(36).substr(2, 5); 
    const displayName = isInitial ? `${name} (Delayed)` : name;

    activeTimers.push({ id: timerId, name: displayName, baseName: name, endTime, team, sharedGroup: effectiveGroup });
    
    updateTimerUI();
    updateButtonStates();
}

function removeTimer(id) {
    activeTimers = activeTimers.filter(t => t.id !== id);
    updateTimerUI();
    updateButtonStates();
}

// 6. Core UI Heartbeat
setInterval(() => {
    const now = Date.now();
    activeTimers = activeTimers.filter(t => t.endTime > now);
    updateTimerUI();
    updateButtonStates();
}, 1000);

// --- DYNAMIC BUTTON STATE ENGINE ---
function updateButtonStates() {
    const now = Date.now();
    const allButtons = document.querySelectorAll('.spawner-btn');
    
    allButtons.forEach(btn => {
        const name = btn.dataset.name;
        const team = btn.dataset.team;
        const max = parseInt(btn.dataset.max, 10) || 1;
        const group = btn.dataset.group;

        const activeCount = activeTimers.filter(t => 
            t.team === team && t.endTime > now &&
            (t.baseName === name || (group !== 'none' && t.sharedGroup === group))
        ).length;

        const available = max - activeCount;

        if (available <= 0) {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.innerHTML = group !== 'none' ? `${name} <br><small>[COOLDOWN]</small>` : `${name} (0/${max})`;
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.innerHTML = group !== 'none' ? `+ ${name}` : `+ ${name} (${available}/${max})`;
        }
    });
}

function updateTimerUI() {
    friendlyActive.innerHTML = '';
    enemyActive.innerHTML = '';
    const now = Date.now();

    activeTimers.sort((a, b) => a.endTime - b.endTime);

    activeTimers.forEach(timer => {
        const remaining = Math.max(0, timer.endTime - now);
        const totalSeconds = Math.floor(remaining / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const timerDiv = document.createElement('div');
        timerDiv.style.cssText = "display: flex; justify-content: space-between; background: rgba(255,255,255,0.1); padding: 10px; margin-bottom: 5px; border-radius: 4px; align-items: center;";

        timerDiv.innerHTML = `
            <span>${timer.name}</span>
            <span style="font-family: monospace; font-size: 1.2em;">${timeString}</span>
            <button onclick="removeTimer('${timer.id}')" style="background: transparent; color: white; border: 1px solid white; cursor: pointer; border-radius: 3px; padding: 2px 6px;">X</button>
        `;

        if (timer.team === 'friendly') {
            friendlyActive.appendChild(timerDiv);
        } else {
            enemyActive.appendChild(timerDiv);
        }
    });
}

// --- INITIAL TIMERS LAUNCHER ---
window.triggerInitialTimers = function(stagingOffsetSeconds = 0) {
    const allButtons = document.querySelectorAll('.spawner-btn');
    
    allButtons.forEach(btn => {
        const name = btn.dataset.name;
        const team = btn.dataset.team;
        const group = btn.dataset.group;
        const max = parseInt(btn.dataset.max, 10) || 1;
        
        let initialDelays = [];
        try {
            initialDelays = JSON.parse(btn.dataset.initialDelays || '[]');
        } catch (e) {
            initialDelays = [];
        }

        // Trigger a timer for each delayed instance (adding staging duration offset if fired at staging start)
        initialDelays.forEach(delay => {
            if (delay > 0) {
                const totalDelay = delay + stagingOffsetSeconds;
                startTimer(name, totalDelay, team, max, group, true);
            }
        });
    });
};

// --- IPC LISTENER FOR FRESH MATCH START ---
if (typeof require !== 'undefined') {
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.on('staging-phase-started', (event, data = {}) => {
            const matchInfo = data.matchInfo || data;
            const isSeed = data.isSeed || false;

            if (matchInfo.isNewMatch !== false) {
                console.log('[Timers] Fresh round start detected. Syncing dropdowns to new factions.');
                
                // 1. Wipe existing active timers from previous match
                activeTimers = [];
                if (friendlyActive) friendlyActive.innerHTML = '';
                if (enemyActive) enemyActive.innerHTML = '';

                // 2. Extract friendly and enemy factions
                const fFac = matchInfo.friendly?.faction || matchInfo.playerFaction || matchInfo.team1?.faction || matchInfo.team1;
                const fDiv = matchInfo.friendly?.division || matchInfo.playerSetup || matchInfo.team1?.division || matchInfo.team1Setup;

                const eFac = matchInfo.enemy?.faction || matchInfo.enemyFaction || matchInfo.team2?.faction || matchInfo.team2;
                const eDiv = matchInfo.enemy?.division || matchInfo.enemySetup || matchInfo.team2?.division || matchInfo.team2Setup;

                // 3. Update dropdowns
                if (fFac && friendlyFaction) {
                    friendlyFaction.value = fFac;
                    if (typeof updateDivisions === 'function') updateDivisions('friendly');
                    if (fDiv && friendlyDivision) friendlyDivision.value = fDiv;
                }

                if (eFac && enemyFaction) {
                    enemyFaction.value = eFac;
                    if (typeof updateDivisions === 'function') updateDivisions('enemy');
                    if (eDiv && enemyDivision) enemyDivision.value = eDiv;
                }

                // 4. Render buttons for the new factions (e.g. USMC vs BAF)
                if (typeof renderSpawnerButtons === 'function') {
                    renderSpawnerButtons();
                }
                
                // 5. Launch initial timers (adds 180s staging offset if fired at staging start)
                const stagingOffset = isSeed ? 120 : 180;
                if (typeof window.triggerInitialTimers === 'function') {
                    window.triggerInitialTimers(stagingOffset);
                }
            } else {
                console.log('[Timers] Joined session mid-match. Skipping automatic initial timers.');
            }
        });
    } catch (err) {
        console.warn('Electron IPC unavailable in browser context.', err);
    }
}
