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
    if (e.key.toLowerCase() === 'q') {
        // activeTeamMode is controlled by globals.js
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
        'settings-view': 'button-settings-view' 
    };

    const targetButtonId = buttonIds[tabName];
    const buttonElement = document.getElementById(targetButtonId);
    
    if (buttonElement) {
        buttonElement.click(); // Trigger the standard tab switch
    }
});