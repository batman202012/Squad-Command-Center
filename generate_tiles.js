const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Disable internal caching to manage memory cleanly with large images
sharp.cache(false);

const tileSize = 256;
const maxZoom = 8;

// The core tiling engine for a single map
async function processMap(inputImage, outputDir, mapName) {
    console.log(`\n========================================`);
    console.log(`🗺️  Starting generation for: ${mapName}`);
    console.log(`========================================`);
    console.log('Reading master map dimensions...');
    
    // Pass { limitInputPixels: false } directly into sharp configuration if handling huge files
    const image = sharp(inputImage, { limitInputPixels: false });
    const metadata = await image.metadata();
    
    const fullWidth = metadata.width;
    const fullHeight = metadata.height;
    
    console.log(`Image loaded successfully: ${fullWidth}x${fullHeight}`);

    for (let z = 0; z <= maxZoom; z++) {
        const scale = Math.pow(2, z);
        const currentSize = tileSize * scale;
        
        console.log(`[${mapName}] Processing Zoom Level ${z} (Canvas: ${currentSize}x${currentSize})...`);
        
        // Resize master image to fit the current zoom layer's dimension grid
        const resizedBuffer = await sharp(inputImage, { limitInputPixels: false })
            .resize(currentSize, currentSize, { fit: 'fill' })
            .toBuffer();

        const numTiles = scale;

        for (let x = 0; x < numTiles; x++) {
            for (let y = 0; y < numTiles; y++) {
                const tileDir = path.join(outputDir, String(z), String(x));
                if (!fs.existsSync(tileDir)) {
                    fs.mkdirSync(tileDir, { recursive: true });
                }

                const tilePath = path.join(tileDir, `${y}.png`);
                
                // Crop each 256x256 tile slice
                await sharp(resizedBuffer)
                    .extract({
                        left: x * tileSize,
                        top: y * tileSize,
                        width: Math.min(tileSize, currentSize - (x * tileSize)),
                        height: Math.min(tileSize, currentSize - (y * tileSize))
                    })
                    .toFile(tilePath);
            }
        }
    }
    console.log(`✅ Success! All standard XYZ tiles generated for ${mapName}.`);
}

// The folder scanner
async function generateAllTiles() {
    // 1. Scan the current directory
    const files = fs.readdirSync(__dirname);
    
    // 2. Filter out anything that isn't a basemap
    const basemaps = files.filter(file => file.endsWith('_basemap.webp'));

    if (basemaps.length === 0) {
        console.log("No files ending in '_basemap.webp' were found in this directory.");
        return;
    }

    console.log(`Found ${basemaps.length} map(s) to process: \n - ${basemaps.join('\n - ')}`);

    // 3. Loop through and process sequentially to save RAM
    for (const file of basemaps) {
        // Extract map name (e.g., 'Yehorivka_basemap.webp' -> 'yehorivka')
        // We lowercase it here to ensure it matches Leaflet's standard URL expectations
        const mapName = file.replace('_basemap.webp', '').toLowerCase();
        
        const inputPath = path.join(__dirname, file);
        const outputDir = path.join(__dirname, 'assets', 'maps', `${mapName}_tiles`);
        
        try {
            await processMap(inputPath, outputDir, mapName);
        } catch (err) {
            console.error(`🚨 Error processing ${mapName}:`, err);
        }
    }
    
    console.log('\n🎉 All maps processed successfully!');
}

generateAllTiles().catch(err => console.error('Global tiling error:', err));