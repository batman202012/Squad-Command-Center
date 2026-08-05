const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const API_BASE_URL = 'http://api.tpun.online/api';
const { exec } = require('child_process');
const { autoUpdater } = require('electron-updater');

let mainWindow; 
let db;

// Track the current match telemetry
let currentMatchState = {
    serverName: null, layer: null, team1: null, team2: null,
    team1Setup: null, team2Setup: null,
    playerFaction: null, enemyFaction: null, matchDateHour: null,
    hash: null, promptSent: false,
    outcome: null, ticketsFriendly: null, ticketsEnemy: null
};

// ==========================================
// --- STATE RESET HELPER ---
// ==========================================
function resetMatchState() {
    currentMatchState = {
        serverName: currentMatchState.serverName, // Keep IP across map rolls
        layer: null, team1: null, team2: null,
        team1Setup: null, team2Setup: null,
        playerFaction: null, enemyFaction: null,
        playerRole: null,
        matchDateHour: null,
        hash: null, promptSent: false,
        outcome: null, ticketsFriendly: null, ticketsEnemy: null
    };
}

// ==========================================
// --- API: FETCH DYNAMIC VOTING INTEL ---
// ==========================================
async function fetchVotingIntel(layer, knownEnemyFaction = null, enemyTeamNum = null) {
    if (!layer) return;

    try {
        console.log(`[Intel] Requesting data for Map: ${layer} | Enemy: ${knownEnemyFaction || 'UNKNOWN (Blind)'} | Enemy Team: ${enemyTeamNum || 'N/A'}`);
        
        // Safely encode parameters so spaces don't break the HTTP request
        let url = `${API_BASE_URL}/intel?layer=${encodeURIComponent(layer)}`;
        if (knownEnemyFaction) {
            url += `&enemy=${encodeURIComponent(knownEnemyFaction)}`;
        }
        if (enemyTeamNum) {
            url += `&enemyTeam=${encodeURIComponent(enemyTeamNum)}`;
        }

        // --- THE MISSING CODE ---
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        
        const intelData = await response.json();
        
        // Send the payload back to the frontend UI
        if (mainWindow) {
            mainWindow.webContents.send('voting-intel-result', intelData);
        }

    } catch (error) {
        console.error("[Intel] Failed to fetch voting intel:", error.message);
        if (mainWindow) {
            mainWindow.webContents.send('voting-intel-result', { error: "Failed to connect to Server API." });
        }
    }
}

// ==========================================
// --- API: SAVE COMPLETED MATCH (POST) ---
// ==========================================
async function submitMatchToServer(matchData) {
    if (!matchData.hash) return; // Prevent empty uploads

    try {
        console.log("Uploading match results to server...");
        
        const response = await fetch(`${API_BASE_URL}/matches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(matchData)
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        
        const serverResponse = await response.json();
        console.log("Match successfully logged:", serverResponse.message);

    } catch (error) {
        console.error("Failed to upload match data:", error.message);
    } finally {
        // --- RESTORED LOGIC ---
        // 1. Push the After-Action Report to the UI (Executes even if API fails)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('match-ended-auto', matchData);
        }
        
        // 2. Wipe current match state so the tracker is ready for the next map roll
        resetMatchState(); 
    }
}

function generateMatchHash(server, layer, pFaction, eFaction, dateHour) {
    const rawString = `${server}_${layer}_${pFaction}_vs_${eFaction}_${dateHour}`;
    return crypto.createHash('md5').update(rawString).digest('hex');
}

// ==========================================
// --- SQUAD LOG WATCHER ---
// ==========================================
function watchSquadLogs() {
    const logPath = path.join(process.env.LOCALAPPDATA, 'SquadGame', 'Saved', 'Logs', 'SquadGame.log');
    
    if (!fs.existsSync(logPath)) {
        console.log(`[Log Watcher] Squad log not found at ${logPath}. Retrying in 10 seconds...`);
        setTimeout(watchSquadLogs, 10000);
        return; 
    }

    console.log(`[Log Watcher] Now watching Squad logs at: ${logPath}`);
    
    const stats = fs.statSync(logPath);
    let fileSize = stats.size;

    // --- SAFE MID-MATCH CATCH-UP (2.5 Hour Limit) ---
    try {
        console.log(`[Log Watcher] Performing memory-safe catch-up read (Max 15 minutes)...`);
        
        // 1. Memory Cap: Only read the last 5MB of the file (prevents RAM crashing on huge logs)
        const maxReadBytes = 5 * 1024 * 1024; 
        const startByte = Math.max(0, stats.size - maxReadBytes);
        
        const fd = fs.openSync(logPath, 'r');
        const buffer = Buffer.alloc(stats.size - startByte);
        fs.readSync(fd, buffer, 0, buffer.length, startByte);
        fs.closeSync(fd);
        
        let existingData = buffer.toString('utf8');
        
        // Clean up the partial first line if we started reading mid-sentence
        if (startByte > 0) {
            existingData = existingData.substring(existingData.indexOf('\n') + 1);
        }
        
        // 2. Chronological Filter: Cut off anything older than 2.5 hours
        const lines = existingData.split('\n');
        const cutoffTime = Date.now() - (120 * 60 * 1000);
        let cutoffIndex = 0;

        // Iterate backwards to find where 2.5 hours ago was
        for (let i = lines.length - 1; i >= 0; i--) {
            // Regex matches Unreal Engine timestamp: [YYYY.MM.DD-HH.MM.SS
            const match = lines[i].match(/^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})/);
            if (match) {
                // Squad bracket timestamps are always UTC, so we append 'Z' for correct math
                const logTime = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`).getTime();
                if (logTime < cutoffTime) {
                    cutoffIndex = i + 1; // Everything after this index is recent
                    break;
                }
            }
        }
        
        const recentData = lines.slice(cutoffIndex).join('\n');
        if (recentData.length > 0) {
            parseLogData(recentData);
        }
        
    } catch (err) {
        console.error("[Log Watcher] Error reading historical log data:", err);
    }

    // --- LIVE FILE WATCHER ---
    fs.watch(logPath, (eventType) => {
        if (eventType === 'change') {
            try {
                const currentStats = fs.statSync(logPath);
                if (currentStats.size > fileSize) {
                    const stream = fs.createReadStream(logPath, { encoding: 'utf8', start: fileSize, end: currentStats.size });
                    stream.on('data', (chunk) => parseLogData(chunk));
                    fileSize = currentStats.size;
                } else if (currentStats.size < fileSize) {
                    fileSize = currentStats.size; // Reset if the game cleared the file on reboot
                }
            } catch (err) { console.error("[Log Watcher] Error:", err); }
        }
    });
}

function parseLogData(data) {
    const lines = data.split('\n');
    
    const serverIpRegex = /LogLoad: LoadMap: ([0-9\.]+:[0-9]+)\//;
    const layerRegex = /OnPreloadMap ([A-Za-z0-9_]+)/;
    const seamlessRegex = /SeamlessTravel to: .*\/([A-Za-z0-9_]+)/; 
    const factionRegex = /Success to load FactionSetup ([A-Za-z0-9_]+) for team ([1-2])/;
    const factionSetupRegex = /Success to load FactionSetup ([\w_]+) for team (\d)/;
    const ticketRegex = /Team ([1-2]), .* has (won|lost) the match with ([0-9]+) Tickets/;

    lines.forEach(line => {
        // --- 0. Detect Network Disconnects & Kicks ---
        if (line.includes("CloseBunch") || line.includes("NetworkFailure") || line.includes("Server connection closed")) {
            if (currentMatchState.serverName || currentMatchState.layer) {
                console.log(`[C2 Engine] Server disconnect detected. Wiping state.`);
                resetMatchState();
                currentMatchState.serverName = null; // Hard wipe IP
            }
        }

        // ==========================================
        // --- PHASE 1: Map Rollover (Blind Pick Phase) ---
        // ==========================================
        
        // 1A. Detect Map Layer Loading (Hard Load from Menu/Direct Connect)
        if (line.includes("OnPreloadMap ")) {
            const match = line.match(layerRegex);
            if (match && match[1]) {
                const parsedLayer = match[1];
                if (parsedLayer === 'EntryMap' || parsedLayer === 'MainMenu_Map') {
                    console.log(`[C2 Engine] Returned to Main Menu. Wiping match state.`);
                    resetMatchState();
                    currentMatchState.serverName = null; 
                } else {
                    if (currentMatchState.layer !== parsedLayer) {
                        resetMatchState(); // Clear old match, keep the IP
                        currentMatchState.layer = parsedLayer;
                        
                        // Fetch Map-Only Intel immediately
                        fetchVotingIntel(currentMatchState.layer, null);
                        
                        currentMatchState.matchDateHour = new Date().toISOString().slice(0, 13);
                        console.log(`[C2 Engine] Map/Layer Detected (Hard Load): ${currentMatchState.layer}`);
                    }
                }
            }
        }

        // 1B. Detect Map Layer Loading (Seamless Server Rotation)
        if (line.includes("SeamlessTravel to:")) {
            const match = line.match(seamlessRegex);
            if (match && match[1]) {
                const parsedLayer = match[1];
                if (currentMatchState.layer !== parsedLayer) {
                    resetMatchState(); // Clear old match, keep the IP
                    currentMatchState.layer = parsedLayer;
                    
                    // Fetch Map-Only Intel immediately
                    fetchVotingIntel(currentMatchState.layer, null);
                    
                    currentMatchState.matchDateHour = new Date().toISOString().slice(0, 13);
                    console.log(`[C2 Engine] Map/Layer Detected (Seamless Rotation): ${currentMatchState.layer}`);
                }
            }
        }

        // 2. Detect Server Connection
        if (line.includes("LogLoad: LoadMap:")) {
            const match = line.match(serverIpRegex);
            if (match && match[1]) {
                if (currentMatchState.serverName !== match[1]) {
                    currentMatchState.serverName = match[1]; 
                    console.log(`[C2 Engine] Connected to Server IP: ${currentMatchState.serverName}`);
                }
            }
        }
        else if (line.includes("JoinSession: joining ")) {
            const newServer = line.split("JoinSession: joining ")[1].trim();
            if (currentMatchState.serverName !== newServer) {
                currentMatchState.serverName = newServer;
                console.log(`[C2 Engine] Joined Server: ${currentMatchState.serverName}`);
            }
        }


        // 3. Detect Factions in the Match
        if (line.includes("Success to load FactionSetup")) {
            const match = line.match(factionRegex);
            if (match && match[1]) {
                const factionName = match[1].split('_')[0]; 
                
                if (!currentMatchState.team1 && line.includes("team 1")) {
                    currentMatchState.team1 = factionName;
                } else if (!currentMatchState.team2 && line.includes("team 2")) {
                    currentMatchState.team2 = factionName;
                }
            }
        }

        const setupMatch = line.match(factionSetupRegex);
        if (setupMatch) {
            const setupName = setupMatch[1]; // e.g., 'CAF_LO_Motorized'
            const teamNum = setupMatch[2];   // e.g., '1' or '2'
            
            if (teamNum === '1') {
                currentMatchState.team1Setup = setupName;
            } else if (teamNum === '2') {
                currentMatchState.team2Setup = setupName;
            }
            
            console.log(`[Telemetry] Team ${teamNum} Setup Locked: ${setupName}`);
        }

        // 4. Trigger UI Selection once both factions are known
        if (currentMatchState.layer && currentMatchState.team1 && currentMatchState.team2 && !currentMatchState.hash && !currentMatchState.promptSent) {
            console.log(`[C2 Engine] Match detected: ${currentMatchState.team1} vs ${currentMatchState.team2}. Waiting for user selection...`);
            if (mainWindow) {
                mainWindow.webContents.send('require-faction-selection', {
                    team1: currentMatchState.team1, team2: currentMatchState.team2
                });
            }
            currentMatchState.promptSent = true; 
        }

        // 5. Capture Ticket Counts and auto-calculate winner
        if (line.includes("Tickets on layer")) {
            const match = line.match(ticketRegex);
            if (match && currentMatchState.hash) {
                const teamNum = parseInt(match[1]);
                const status = match[2]; // "won" or "lost"
                const tickets = parseInt(match[3]);

                // Determine if this specific log line belongs to the player's team
                const isPlayerTeam = (teamNum === 1 && currentMatchState.playerFaction === currentMatchState.team1) ||
                                     (teamNum === 2 && currentMatchState.playerFaction === currentMatchState.team2);

                if (isPlayerTeam) {
                    currentMatchState.outcome = (status === "won") ? "Victory" : "Defeat";
                    currentMatchState.ticketsFriendly = tickets;
                } else {
                    currentMatchState.ticketsEnemy = tickets;
                }
                
                // Once we have both ticket values, the match is officially over. Save it instantly!
                if (currentMatchState.ticketsFriendly !== null && currentMatchState.ticketsEnemy !== null) {
                    submitMatchToServer(currentMatchState);
                }
            }
        }
    });
}

// ==========================================
// --- IPC HANDLERS ---
// ==========================================
ipcMain.on('user-selected-faction', (event, selectedFaction) => {
    currentMatchState.playerFaction = selectedFaction;
    currentMatchState.enemyFaction = (selectedFaction === currentMatchState.team1) ? currentMatchState.team2 : currentMatchState.team1;
    
    if (currentMatchState.layer && currentMatchState.layer.toLowerCase().includes('invasion')) {
        // Team 1 is always Defender in Squad Invasion, Team 2 is Attacker
        currentMatchState.playerRole = (selectedFaction === currentMatchState.team1) ? 'Defender' : 'Attacker';
    } else {
        currentMatchState.playerRole = 'N/A';
    }

    currentMatchState.hash = generateMatchHash(
        currentMatchState.serverName || "LocalServer",
        currentMatchState.layer,
        currentMatchState.playerFaction,
        currentMatchState.enemyFaction,
        currentMatchState.matchDateHour
    );

    console.log(`[C2 Engine] Player selected ${currentMatchState.playerFaction}. MATCH STARTED!`);
    if (mainWindow) mainWindow.webContents.send('match-started', currentMatchState);
});

ipcMain.handle('read-map-json', async (event, mapId) => {
    try {
        // Build the safe path inside the ASAR archive
        const jsonPath = path.join(__dirname, 'assets', 'data', `hab_${mapId}.json`);
        
        // Return the parsed object directly
        const rawData = fs.readFileSync(jsonPath, 'utf-8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error(`[Backend] Failed to read HAB JSON for: ${mapId}`);
        return null; // Return null so the frontend knows it failed gracefully
    }
});

// ==========================================
// --- API: FETCH FULL DASHBOARD (GET) ---
// ==========================================
ipcMain.on('request-meta-dashboard', async (event) => {
    try {
        console.log("[Intel] Fetching global dashboard stats from  Server...");
        
        const response = await fetch(`${API_BASE_URL}/dashboard`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        
        const dashboardData = await response.json();
        
        // Send the payload back to the frontend UI
        event.reply('meta-dashboard-update', dashboardData);

    } catch (error) {
        console.error("[Intel] Dashboard fetch failed:", error.message, API_BASE_URL);
        // Send an error state to the UI so it doesn't hang
        event.reply('meta-dashboard-update', { error: "Failed to connect to Server API." });
    }
});

// ==========================================
// --- API: MANUAL VOTING INTEL OVERRIDE ---
// ==========================================
ipcMain.on('request-manual-intel', (event, data) => {
    console.log(`[C2 Engine] Manual Intel Request - Layer: ${data.layer} | Enemy: ${data.enemy || 'Blind'} | Enemy Team: ${data.enemyTeam || 'N/A'}`);
    
    // Only update the live telemetry state if the user is actively researching the current match
    if (data.enemy && currentMatchState.layer === data.layer) {
        currentMatchState.enemyFaction = data.enemy;
        console.log(`[C2 Engine] Live enemy faction updated to: ${data.enemy}`);
    }
    
    // Fetch the new data from the backend API, passing the enemyTeam (1 or 2)
    fetchVotingIntel(data.layer, data.enemy || null, data.enemyTeam || null);
});

// ==========================================
// --- API: FETCH MAP LAYERS FROM FOLDER ---
// ==========================================
ipcMain.on('request-map-layers', (event, mapId) => {
    // Capitalize the first letter to match your folder structure (e.g., "albasrah" -> "Albasrah")
    const folderName = mapId.charAt(0).toUpperCase() + mapId.slice(1);
    const mapDir = path.join(__dirname, 'assets', 'maps', folderName);

    fs.readdir(mapDir, (err, files) => {
        if (err) {
            console.error(`[C2 Engine] Directory not found or unreadable: ${mapDir}`);
            event.reply('map-layers-response', { success: false, layers: [] });
            return;
        }

        // Filter out any non-JSON files and strip the '.json' extension to get the clean Layer ID
        const layerNames = files
            .filter(file => file.endsWith('.json'))
            .map(file => file.replace('.json', ''));
        
        event.reply('map-layers-response', { success: true, layers: layerNames });
    });
});

// ==========================================
// --- STEAMWORKS P2P MULTIPLAYER ENGINE ---
// ==========================================
const steamworks = require('steamworks.js');
let steamClient;
let activeLobbyId = null;
let isLobbyHost = false;
let currentHostId = null; 
let connectedPeers = new Set(); // Approved squadmates (Receive map updates)
let pendingPeers = new Set();   // Waiting Room (No map updates)
let peerNames = new Map();
let tacticalHistory = new Map();

try {
    steamClient = steamworks.init(480);
    console.log(`[Steamworks] Initialized as ${steamClient.localplayer.getName()}`);

    // SteamCallback ID 6: P2PSessionRequest
    steamClient.callback.register(6, (req) => {
        const remoteUser = req.remote || req.steamID || req.steamId || req.id;
        if (activeLobbyId && remoteUser) {
            if (steamClient.networking && typeof steamClient.networking.acceptP2PSession === 'function') {
                steamClient.networking.acceptP2PSession(BigInt(remoteUser));
            }
        }
    });

    // SteamCallback ID 8: GameLobbyJoinRequested
    steamClient.callback.register(8, async (req) => {
        const targetLobby = req.lobby_steam_id || req.lobbyId || req.lobbyID || req.lobby_id || req.id || req.lobby; 
        const hostSteamId = req.friend_steam_id || req.friendSteamId;

        if (targetLobby) {
            await joinSteamLobby(targetLobby, hostSteamId);
        }
    });

    // --- CACHE HELPER FOR LATE JOINERS ---
    function updateTacticalHistory(data) {
        if (!data || !data.id) return;
        
        if (data.action === 'delete') {
            tacticalHistory.delete(data.id);
        } else if (data.action === 'update-shape' || data.action === 'move-marker') {
            if (tacticalHistory.has(data.id)) {
                let cachedData = tacticalHistory.get(data.id);
                if (data.action === 'update-shape') cachedData.geojson = data.geojson;
                if (data.action === 'move-marker') cachedData.latlng = data.latlng;
                tacticalHistory.set(data.id, cachedData);
            }
        } else {
            // Store brand new drawings
            tacticalHistory.set(data.id, data);
        }
    }

    // --- P2P PACKET POLLING LOOP ---
    setInterval(() => {
        if (!steamClient || !activeLobbyId || !steamClient.networking) return;
        
        let packetSize = steamClient.networking.isP2PPacketAvailable();
        
        while (packetSize > 0) {
            const packet = steamClient.networking.readP2PPacket(packetSize);
            packetSize = steamClient.networking.isP2PPacketAvailable(); 
            
            if (!packet || !packet.data) continue;
            
            const rawSenderObj = packet.steamId || packet.steamID || packet.user || packet.identity;
            const senderBigInt = (typeof rawSenderObj === 'bigint') ? rawSenderObj : (rawSenderObj.steamId64 || rawSenderObj.steamID64);
            const senderId = senderBigInt ? senderBigInt.toString() : null;

            if (!senderId) continue;

            let payload;
            try {
                payload = JSON.parse(packet.data.toString('utf8'));
            } catch (e) { continue; } 

            // --- 1. WAITING ROOM HANDSHAKE ---
            if (payload.type === 'TACTICAL_SYNC' && payload.data && payload.data.action === 'handshake') {
                const incomingName = payload.data.name || "Unknown Soldier";
                peerNames.set(senderId, incomingName); 
                
                if (typeof steamClient.networking.acceptP2PSession === 'function') {
                    steamClient.networking.acceptP2PSession(senderBigInt);
                }

                if (isLobbyHost) {
                    console.log(`[Waiting Room] Peer ${incomingName} wants to join/rejoin.`);
                    
                    connectedPeers.delete(senderId); 
                    
                    pendingPeers.add(senderId); 
                    broadcastLobbyState();
                }
                continue; 
            }

            // --- 2. HOST KICK SIGNAL (Soft Ban) ---
            if (payload.type === 'TACTICAL_SYNC' && payload.data && payload.data.action === 'kicked') {
                console.log("[Steamworks] You were kicked by the Host.");
                connectedPeers.clear();
                pendingPeers.clear();
                activeLobbyId = null;
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('p2p-kicked'); 
                }
                continue;
            }

            // --- 3. HOST APPROVAL SIGNAL ---
            if (payload.type === 'TACTICAL_SYNC' && payload.data && payload.data.action === 'approved') {
                const hostName = payload.data.name || "Host";
                console.log(`[Steamworks] Host ${hostName} approved your connection!`);
                peerNames.set(senderId, hostName);
                connectedPeers.add(senderId); 
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('p2p-approved'); 
                }
                broadcastLobbyState();
                continue;
            }

            // --- 4. TACTICAL SYNC (OPSEC ENFORCED) ---
            if (!connectedPeers.has(senderId)) continue;

            if (payload.type === 'TACTICAL_SYNC') {
                
                if (isLobbyHost) {
                    updateTacticalHistory(payload.data);
                }

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('p2p-receive-tactical', payload.data);
                }
                
                if (isLobbyHost) relayPacketToLobby(packet.data, senderId);
            }

            // --- 5. CLIENT RESYNC REQUEST ---
            if (payload.type === 'TACTICAL_SYNC' && payload.data && payload.data.action === 'request-sync') {
                if (isLobbyHost && connectedPeers.has(senderId)) {
                    console.log(`[Steamworks] Peer ${senderId} requested a manual map resync. Dumping cache...`);
                    
                    let syncDelay = 50; 
                    tacticalHistory.forEach((data, id) => {
                        setTimeout(() => {
                            const catchupBuffer = Buffer.from(JSON.stringify({ type: 'TACTICAL_SYNC', data }));
                            if (steamClient.networking && typeof steamClient.networking.sendP2PPacket === 'function') {
                                steamClient.networking.sendP2PPacket(BigInt(senderId), 2, catchupBuffer);
                            }
                        }, syncDelay);
                        syncDelay += 15; 
                    });
                }
                continue;
            }
        }
    }, 16);

} catch (error) {
    console.warn("[Steamworks] Failed to init. Steam is likely not running.", error.message);
}

// --- IPC HANDLERS FOR UI ---
ipcMain.handle('steam-host-lobby', async () => {
    try {
        const lobby = await steamClient.matchmaking.createLobby(1, 9);
        activeLobbyId = lobby.id;
        isLobbyHost = true;
        currentHostId = steamClient.localplayer.getSteamId().steamId64.toString();
        
        // Cache our own name
        peerNames.set(currentHostId, steamClient.localplayer.getName());
        
        connectedPeers.clear();
        pendingPeers.clear();
        return { success: true, lobbyId: activeLobbyId.toString() };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.on('steam-invite-friends', () => {
    if (activeLobbyId && steamClient) steamClient.overlay.activateInviteDialog(activeLobbyId);
});

// CLIENT ACTION: Request Manual Resync from Host
ipcMain.on('steam-request-resync', () => {
    if (activeLobbyId && currentHostId && !isLobbyHost) {
        console.log(`[Steamworks] Requesting manual map resync from Host: ${currentHostId}`);
        const requestBuffer = Buffer.from(JSON.stringify({ 
            type: 'TACTICAL_SYNC', 
            data: { action: 'request-sync' } 
        }));
        if (steamClient.networking && typeof steamClient.networking.sendP2PPacket === 'function') {
            steamClient.networking.sendP2PPacket(BigInt(currentHostId), 2, requestBuffer);
        }
    }
});

// HOST ACTION: Approve User
ipcMain.on('steam-approve-user', (event, targetId) => {
    if (isLobbyHost && activeLobbyId) {
        pendingPeers.delete(targetId);
        connectedPeers.add(targetId); // Move to approved list

        // Send approval to client with our name
        const approvalBuffer = Buffer.from(JSON.stringify({ 
            type: 'TACTICAL_SYNC', 
            data: { action: 'approved', name: steamClient.localplayer.getName() } 
        }));
        
        if (steamClient.networking && typeof steamClient.networking.sendP2PPacket === 'function') {
            steamClient.networking.sendP2PPacket(BigInt(targetId), 2, approvalBuffer);
        }

        broadcastLobbyState();

        let syncDelay = 50; // Initial delay to let the approval packet process first
        tacticalHistory.forEach((data, id) => {
            setTimeout(() => {
                const catchupBuffer = Buffer.from(JSON.stringify({ type: 'TACTICAL_SYNC', data }));
                if (steamClient.networking && typeof steamClient.networking.sendP2PPacket === 'function') {
                    steamClient.networking.sendP2PPacket(BigInt(targetId), 2, catchupBuffer);
                }
            }, syncDelay);
            syncDelay += 15; // 15ms gap between each packet
        });
    }
});

// HOST ACTION: Kick/Soft-Ban User
ipcMain.on('steam-kick-user', (event, steamIdToKick) => {
    if (isLobbyHost && activeLobbyId) {
        // 1. Send the Kill Signal to their client so their map wipes
        const kickBuffer = Buffer.from(JSON.stringify({ type: 'TACTICAL_SYNC', data: { action: 'kicked' } }));
        if (steamClient.networking && typeof steamClient.networking.sendP2PPacket === 'function') {
            steamClient.networking.sendP2PPacket(BigInt(steamIdToKick), 2, kickBuffer);
        }

        // 2. Erase them from memory and drop the socket
        setTimeout(() => {
            connectedPeers.delete(steamIdToKick);
            pendingPeers.delete(steamIdToKick);
            if (steamClient.networking && typeof steamClient.networking.closeP2PSessionWithUser === 'function') {
                steamClient.networking.closeP2PSessionWithUser(BigInt(steamIdToKick));
            }
            broadcastLobbyState();
        }, 100); // Give the packet 100ms to send before cutting the cord
    }
});

// CATCHUP SYNC: Send current map state to a specific newly joined user
ipcMain.on('p2p-send-catchup-sync', (event, { targetId, stateData }) => {
    if (!steamClient || !steamClient.networking) return;
    const buffer = Buffer.from(JSON.stringify({ type: 'TACTICAL_SYNC', data: stateData }));
    steamClient.networking.sendP2PPacket(BigInt(targetId), 2, buffer);
});

// --- CLEAR HISTORY CACHE ---
ipcMain.on('clear-tactical-history', () => {
    console.log("[Backend] Tactical map wiped. Clearing history cache.");
    tacticalHistory.clear();
});

// Broadcast outgoing tactical drawings to peers
ipcMain.on('p2p-broadcast-tactical', (event, data) => {
    
    // 1. Maintain the Backend History Cache (using our smart helper)
    updateTacticalHistory(data);

    // 2. Network Relay
    if (!steamClient || !activeLobbyId || !steamClient.networking) return;
    const buffer = Buffer.from(JSON.stringify({ type: 'TACTICAL_SYNC', data }));
    relayPacketToLobby(buffer, steamClient.localplayer.getSteamId().steamId64.toString());
});

async function joinSteamLobby(lobbyId, hostSteamId) {
    try {
        await steamClient.matchmaking.joinLobby(BigInt(lobbyId));
        activeLobbyId = lobbyId;
        isLobbyHost = false;
        currentHostId = hostSteamId.toString();
        
        peerNames.set(steamClient.localplayer.getSteamId().steamId64.toString(), steamClient.localplayer.getName());
        broadcastLobbyState();

        if (hostSteamId && steamClient.networking) {
            if (typeof steamClient.networking.acceptP2PSession === 'function') {
                steamClient.networking.acceptP2PSession(BigInt(hostSteamId));
            }

            // Client sends their explicit name in the handshake
            const handshake = Buffer.from(JSON.stringify({ 
                type: 'TACTICAL_SYNC', 
                data: { action: 'handshake', name: steamClient.localplayer.getName() } 
            }));
            
            if (typeof steamClient.networking.sendP2PPacket === 'function') {
                steamClient.networking.sendP2PPacket(BigInt(hostSteamId), 2, handshake);
            }
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('steam-lobby-joined', lobbyId.toString());
        }
    } catch (e) {
        console.error("Failed to join lobby:", e);
    }
}

function broadcastLobbyState() {
    setTimeout(() => {
        if (mainWindow && activeLobbyId && !mainWindow.isDestroyed()) {
            try {
                const localSteamId = steamClient.localplayer.getSteamId().steamId64.toString();
                
                let uniqueIds = new Set([...connectedPeers, ...pendingPeers]);
                uniqueIds.add(localSteamId); // Always ensure the host is in the list

                const memberData = Array.from(uniqueIds).map(id => {
                    // Extract name explicitly from our Cache
                    const friendName = peerNames.get(id) || `User_${id.substring(id.length - 4)}`;
                    return { 
                        id: id, 
                        name: friendName,
                        isHost: (id === currentHostId),
                        isPending: pendingPeers.has(id) // If they are in pending, flag them for the waiting room UI
                    };
                });
                    
                mainWindow.webContents.send('steam-lobby-members', memberData);
            } catch (err) {
                console.error("[Steamworks] Failed to update lobby members:", err);
            }
        }
    }, 200);
}

function relayPacketToLobby(buffer, excludeSteamId) {
    if (!steamClient.networking) return;

    // ONLY send to APPROVED peers
    connectedPeers.forEach(peerId => {
        if (peerId !== excludeSteamId && peerId !== steamClient.localplayer.getSteamId().steamId64.toString()) {
            if (typeof steamClient.networking.sendP2PPacket === 'function') {
                steamClient.networking.sendP2PPacket(BigInt(peerId), 2, buffer);
            }
        }
    });
}

// ==========================================
// --- ELECTRON WINDOW & APP ---
// ==========================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    // --- OPSEC: PREVENT SCREEN CAPTURE & STEAM BROADCASTING ---
    mainWindow.setContentProtection(true);

    mainWindow.loadFile('index.html');

    // INTERCEPT STEAM PROTOCOL LINKS
    mainWindow.webContents.on('will-frame-navigate', (event) => {
        if (event.url.startsWith('steam://')) {
            event.preventDefault(); 
            shell.openExternal(event.url); 
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('steam://')) {
            shell.openExternal(url);
            return { action: 'deny' }; 
        }
        return { action: 'allow' };
    });
}

app.whenReady().then(() => {
    createWindow();
    
    mainWindow.webContents.once('did-finish-load', () => {
        watchSquadLogs();
    });

    // --- TAB HOTKEYS ---
    globalShortcut.register('Alt+1', () => {
        if (mainWindow) mainWindow.webContents.send('switch-tab', 'map-view');
    });
    
    globalShortcut.register('Alt+2', () => {
        if (mainWindow) mainWindow.webContents.send('switch-tab', 'armor-view');
    });

    globalShortcut.register('Alt+3', () => {
        if (mainWindow) mainWindow.webContents.send('switch-tab', 'meta-view');
    });

    globalShortcut.register('Alt+4', () => {
        if (mainWindow) mainWindow.webContents.send('switch-tab', 'uniform-view');
    });

    globalShortcut.register('Alt+5', () => {
        if (mainWindow) mainWindow.webContents.send('switch-tab', 'browser-view');
    });

    globalShortcut.register('Alt+9', () => {
        if (mainWindow) mainWindow.webContents.send('switch-tab', 'settings-view');
    });

    // --- INSTANT FOCUS TOGGLE (LOCAL & GEFORCE NOW SUPPORT) ---
    globalShortcut.register('Alt+Shift+F', () => {
        if (mainWindow.isFocused()) {
            console.log("Pushing focus back to the Game...");
            const psCommand = `powershell -NoProfile -Command "$p = Get-Process | Where-Object { ($_.ProcessName -match 'Squad' -or $_.MainWindowTitle -match 'GeForce NOW') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { $w = $p.MainWindowHandle; $sig = '[DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr h, int nCmd);'; $api = Add-Type -MemberDefinition $sig -Name WAPI -Namespace Win32 -PassThru; $api::ShowWindow($w, 9); $api::SetForegroundWindow($w); }"`;
            
            exec(psCommand, (error) => {
                if (error) console.error("Focus switch failed:", error);
            });
        } else {
            console.log("Pulling focus to Command Center...");
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    // --- AUTO-UPDATER ---
    autoUpdater.checkForUpdatesAndNotify();
});

autoUpdater.on('update-downloaded', (info) => {
    
    // Clean up the release notes by stripping HTML-significant characters and providing a default message if none exist
    const releaseNotes = info.releaseNotes 
        ? info.releaseNotes.replace(/[<>]/g, '') 
        : 'Bug fixes and performance improvements.';

    const dialogOpts = {
        type: 'info',
        buttons: ['Restart and Install', 'Later'],
        title: 'Application Update',
        message: `Version ${info.version} is ready to install!`,
        detail: `Changelog:\n${releaseNotes}`
    };

    // Show the popup to the user
    dialog.showMessageBox(dialogOpts).then((returnValue) => {
        if (returnValue.response === 0) {
            autoUpdater.quitAndInstall();
        }
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
