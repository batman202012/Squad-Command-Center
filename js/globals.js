// ==========================================
// --- GLOBAL APP STATE (globals.js) ---
// ==========================================

// Map & Scale Data (Dynamically injected on map load)
var map; 
var baseTileLayer; 
var currentMapData = null; 
var meterScale = 1;
var masterMapSize = 10000; 
var playerTeamIndex = 1;

// Tactical State
var activeTeamMode = 'friendly'; 
var activeLineTool = null;
var activeSquadNum = null;

// Engine States
var isLosActive = false;
var isMortarCalcActive = false;