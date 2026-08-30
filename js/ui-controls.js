// ==========================================
// --- APP UI & HOTKEYS (ui-controls.js) ---
// ==========================================

const { ipcRenderer } = require('electron');

// Geoman Sidebar Toggles (Edit / Remove / Toggles)
document.querySelectorAll('.action-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        if (e.currentTarget.id === 'los-toggle-btn' || e.currentTarget.id === 'mortar-calc-btn') return;

        if (e.currentTarget.id === 'toggle-layer-btn') {
            if (typeof window.toggleLayerOverlay === 'function') {
                const isVis = window.toggleLayerOverlay();
                e.currentTarget.style.backgroundColor = isVis ? '#333' : '#cc0000';
            }
            return;
        }

        if (e.currentTarget.id === 'toggle-team-btn') {
            // Flip the index between 1 and 2
            window.playerTeamIndex = window.playerTeamIndex === 1 ? 2 : 1;
            e.currentTarget.innerText = `🟦 Deploying As: Team ${window.playerTeamIndex}`;
            
            // Clear any active RAAS paths and redraw the layer with the new Blue/Red assignments
            if (typeof renderCurrentLayerState === 'function') {
                raasSelectedPath = []; 
                renderCurrentLayerState();
            }
            return;
        }

        if (typeof lockViewshedForDrawing === 'function') lockViewshedForDrawing();

        const action = e.currentTarget.getAttribute('data-action');
        if (action === 'Edit') map.pm.toggleGlobalEditMode();
        else if (action === 'Remove') map.pm.toggleGlobalRemovalMode();
    });
});

// Tab Switching
window.switchTab = function(viewId, btnElement) {
    // Ensure shortcuts are active when leaving settings
    ipcRenderer.send('resume-global-shortcuts');

    if (typeof window.hideContextMenu === 'function') {
        window.hideContextMenu();
    }

    // Hide all views and deactivate all buttons
    document.querySelectorAll('.view-container').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

    // Show the target view and activate the clicked button
    document.getElementById(viewId).classList.add('active');
    if (btnElement) btnElement.classList.add('active'); // Added safety check

    // If we are switching back to the map, force Leaflet to recalculate its dimensions
    if (viewId === 'map-view' && typeof map !== 'undefined' && map !== null) {
        // A 50ms timeout ensures the CSS 'display: flex' has finished rendering before Leaflet checks the size
        setTimeout(() => {
            map.invalidateSize();
        }, 50);
    }

    // Handle specific sub-UI logic based on the active tab
    const factionSelect = document.getElementById('faction-sync');
    if (factionSelect) {
        factionSelect.style.display = viewId === 'armor-view' ? 'block' : 'none';
    }

    // Fetch Meta Dashboard data dynamically when the tab is opened
    if (viewId === 'meta-view') {
        const metaContainer = document.getElementById('meta-dashboard-content');
        if (metaContainer) {
            metaContainer.innerHTML = '<p style="color: #888;">Fetching latest intel from home server...</p>';
        }
        // Send signal to main.js to ping the Home Server
        ipcRenderer.send('request-meta-dashboard');
    }
};

// Armor Iframe Syncing
window.syncArmorWindows = function(factionCode) {
    if (!factionCode) return; 
    const newUrl = `https://squad-armor.com/vehicles?faction=${encodeURIComponent(factionCode)}`;
    const armorFrames = document.querySelectorAll('#armor-view iframe');
    armorFrames.forEach(frame => { frame.src = newUrl; });
};

// Maximize Quadrants
window.toggleMaximize = function(quadId) {
    const armorView = document.getElementById('armor-view');
    const targetQuad = document.getElementById(quadId);
    const btn = targetQuad.querySelector('.max-btn');

    if (targetQuad.classList.contains('maximized')) {
        targetQuad.classList.remove('maximized');
        armorView.classList.remove('has-maximized');
        btn.innerText = 'Maximize';
    } else {
        targetQuad.classList.add('maximized');
        armorView.classList.add('has-maximized');
        btn.innerText = 'Minimize';
    }
};

// Global Hotkeys (Q and 1-9)
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const contextMenu = document.getElementById('squad-context-menu');
    const modeOverlay = document.getElementById('mode-overlay');

    // TOGGLE TEAM MODE
    if (e.key.toLowerCase() === 'q' && !e.altKey && !e.ctrlKey) {
        activeTeamMode = activeTeamMode === 'friendly' ? 'enemy' : 'friendly';
        
        if (activeTeamMode === 'friendly') {
            modeOverlay.className = 'mode-friendly';
            modeOverlay.innerText = "Mode: FRIENDLY (Press 'Q' to swap)";
            contextMenu.classList.remove('enemy-mode');
            contextMenu.classList.add('friendly-mode');
        } else {
            modeOverlay.className = 'mode-enemy';
            modeOverlay.innerText = "Mode: ENEMY (Press 'Q' to swap)";
            contextMenu.classList.remove('friendly-mode');
            contextMenu.classList.add('enemy-mode');
        }
    }

    // QUICK SQUAD MOVEMENT
    if (contextMenu && !contextMenu.classList.contains('hidden')) {
        if (e.key >= '1' && e.key <= '9') {
            const squadBtn = document.querySelector(`.context-draw-btn[data-squad="${e.key}"]`);
            if (squadBtn) squadBtn.click();
        }
    }
});

// Electron IPC Listeners
ipcRenderer.on('switch-tab', (event, tabName) => {
    console.log(`Frontend received signal: Switch to ${tabName}`);
    
    // Map the backend string to the exact HTML button IDs
    const buttonIds = {
        'map-view': 'button-map-view',      
        'armor-view': 'button-armor-view',
        'meta-view': 'button-meta-view',
        'uniform-view': 'button-uniform-view',
        'browser-view': 'button-browser-view',
        'timers-view': 'button-timers-view',
        'settings-view': 'button-settings-view' 
    };

    const targetButtonId = buttonIds[tabName];
    const buttonElement = document.getElementById(targetButtonId);
    
    if (buttonElement) {
        buttonElement.click(); // Trigger the standard tab switch
    }
});

// --- GLOBAL MAP PANNING LISTENER ---
ipcRenderer.on('pan-map', (event, { dx, dy }) => {
    const targetMap = window.map || (typeof map !== 'undefined' ? map : null);
    if (targetMap) {
        targetMap.panBy([dx, dy], {
            animate: true,
            duration: 0.15 // Smooth transition duration in seconds
        });
    }
});

// ==========================================
// --- SETTINGS & KEYBIND RECORDER LOGIC ---
// ==========================================

const defaultHotkeys = {
    panUp: 'Alt+W',
    panDown: 'Alt+S',
    panLeft: 'Alt+A',
    panRight: 'Alt+D',
    zoomIn: 'Alt+E',
    zoomOut: 'Alt+Q',
    toggleFocus: 'Alt+Shift+F',
    tabMap: 'Alt+1',
    tabArmor: 'Alt+2',
    tabMeta: 'Alt+3',
    tabUniform: 'Alt+4',
    tabTimers: 'Alt+5',
    tabBrowser: 'Alt+6',
    tabSettings: 'Alt+9'
};

// Map Electron Accelerator Key Names
function formatElectronKey(e) {
    const modifiers = [];
    if (e.ctrlKey) modifiers.push('Ctrl');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    if (e.metaKey) modifiers.push('Meta');

    let key = e.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;

    if (key.length === 1) {
        key = key.toUpperCase();
    } else if (key === 'ArrowUp') key = 'Up';
    else if (key === 'ArrowDown') key = 'Down';
    else if (key === 'ArrowLeft') key = 'Left';
    else if (key === 'ArrowRight') key = 'Right';
    else if (key === ' ') key = 'Space';
    else if (key === 'Escape') key = 'Esc';

    if (modifiers.length === 0 && key.length === 1 && key >= 'A' && key <= 'Z') {
        // Require at least Alt or Ctrl for single character letters to avoid conflicts
        return null;
    }

    return [...modifiers, key].join('+');
}

// Load and populate settings on startup
async function initSettingsUI() {
    try {
        const settings = await ipcRenderer.invoke('get-app-settings');
        if (!settings) return;

        // Pan Distance
        const panInput = document.getElementById('pan-distance-input');
        if (panInput && settings.panDistance) {
            panInput.value = settings.panDistance;
        }

        // Grid Opacity
        const opacitySlider = document.getElementById('grid-opacity-slider');
        const opacityLabel = document.getElementById('opacity-val');
        if (opacitySlider && settings.gridOpacity !== undefined) {
            opacitySlider.value = settings.gridOpacity;
            if (opacityLabel) opacityLabel.innerText = `${Math.round(settings.gridOpacity * 100)}%`;
            if (typeof window.setGridOpacity === 'function') {
                window.setGridOpacity(settings.gridOpacity);
            }
        }

        // Hotkey Inputs
        if (settings.hotkeys) {
            document.querySelectorAll('.hotkey-input').forEach(input => {
                const keyName = input.getAttribute('data-key');
                if (settings.hotkeys[keyName]) {
                    input.value = settings.hotkeys[keyName];
                }
            });
        }
    } catch (err) {
        console.error("[Settings UI] Failed to load settings:", err);
    }
}

// Keybind input recorder event listeners
document.querySelectorAll('.hotkey-input').forEach(input => {
    input.addEventListener('focus', () => {
        // Tell main.js to release all global shortcuts so DOM can capture any key combination
        ipcRenderer.send('disable-global-shortcuts');
        
        input.style.borderColor = '#007acc';
        input.style.backgroundColor = '#2d2d30';
        input.setAttribute('placeholder', 'Press shortcut...');
    });

    input.addEventListener('blur', () => {
        // Re-enable global shortcuts once recording is finished
        ipcRenderer.send('resume-global-shortcuts');
        
        input.style.borderColor = '#555';
        input.style.backgroundColor = '#1e1e1e';
    });

    input.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Clear keybind with Backspace or Delete
        if (e.key === 'Backspace' || e.key === 'Delete') {
            input.value = '';
            input.blur();
            return;
        }

        const combo = formatElectronKey(e);
        if (combo) {
            input.value = combo;
            input.blur(); // Automatically blurs and restores shortcuts
        }
    });
});

// Update opacity text live
const gridSlider = document.getElementById('grid-opacity-slider');
if (gridSlider) {
    gridSlider.addEventListener('input', (e) => {
        const lbl = document.getElementById('opacity-val');
        if (lbl) lbl.innerText = `${Math.round(e.target.value * 100)}%`;
        if (typeof window.setGridOpacity === 'function') {
            window.setGridOpacity(parseFloat(e.target.value));
        }
    });
}

// Save Settings Button
const btnSaveSettings = document.getElementById('btn-save-settings');
if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
        const panInput = document.getElementById('pan-distance-input');
        const opacitySlider = document.getElementById('grid-opacity-slider');

        const newHotkeys = {};
        document.querySelectorAll('.hotkey-input').forEach(input => {
            const key = input.getAttribute('data-key');
            newHotkeys[key] = input.value.trim();
        });

        const payload = {
            panDistance: parseInt(panInput.value, 10) || 150,
            gridOpacity: parseFloat(opacitySlider ? opacitySlider.value : 0.80),
            hotkeys: newHotkeys
        };

        btnSaveSettings.innerText = "⏳ Saving...";
        const success = await ipcRenderer.invoke('save-app-settings', payload);

        btnSaveSettings.innerText = "💾 Save Settings";
        const statusMsg = document.getElementById('settings-status-msg');
        if (statusMsg) {
            statusMsg.style.display = 'inline';
            statusMsg.innerText = success ? "✅ Settings Saved!" : "❌ Error Saving";
            setTimeout(() => { statusMsg.style.display = 'none'; }, 2500);
        }
    });
}

// Reset Hotkeys Button
const btnResetHotkeys = document.getElementById('btn-reset-hotkeys');
if (btnResetHotkeys) {
    btnResetHotkeys.addEventListener('click', () => {
        document.querySelectorAll('.hotkey-input').forEach(input => {
            const key = input.getAttribute('data-key');
            if (defaultHotkeys[key]) {
                input.value = defaultHotkeys[key];
            }
        });
        const panInput = document.getElementById('pan-distance-input');
        if (panInput) panInput.value = 150;
    });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initSettingsUI);
initSettingsUI();

// Map Pan Listener
ipcRenderer.on('pan-map', (event, { dx, dy }) => {
    const targetMap = window.map || (typeof map !== 'undefined' ? map : null);
    if (targetMap) {
        targetMap.panBy([dx, dy], {
            animate: true,
            duration: 0.15
        });
    }
});

// --- GLOBAL MAP ZOOM LISTENER ---
ipcRenderer.on('zoom-map', (event, direction) => {
    const targetMap = window.map || (typeof map !== 'undefined' ? map : null);
    if (targetMap) {
        if (direction === 'in') {
            targetMap.zoomIn(1, { animate: true });
        } else if (direction === 'out') {
            targetMap.zoomOut(1, { animate: true });
        }
    }
});