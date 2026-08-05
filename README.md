# Squad C2 Center

A lightweight, powerful desktop application built for tactical planning, command coordination, and armor analysis in the game *Squad*. 

Squad C2 Center provides real-time dynamic map gridding, RAAS lane probability tracking, indoor HAB plotting, and an interactive armor viewer. By keeping the layer logic local and streaming high-resolution map tiles from a remote server, the app delivers a massive amount of tactical data in a very small footprint (under 500MB).

## Features

- **Advanced Tactical Mapping:** View full high-resolution maps for every layer in the game (AAS, RAAS, Invasion, Insurgency, etc.).
- **RAAS Lane Probability:** Automatically calculates and draws RAAS lane probabilities based on known flag captures and exclusions.
- **Dynamic Grid System:** Accurately renders physical grid scales (meters) that adjust dynamically as you zoom.
- **Armor Viewer Integration:** Seamlessly inspect vehicle armor values and weak points directly within the app.
- **Topographical Heightmaps:** Toggle heightmaps to analyze elevation and sightlines.
- **Indoor HAB Tracking:** Visualize custom indoor HAB locations and build constraints.
- **Ultra-Lightweight:** The heaviest map tiles (8+ GB) are securely streamed from a remote server so they don't eat up your hard drive space.

## 🛡️ Safety, Security & Transparency

We understand that downloading `.exe` files from the internet requires trust. **Squad C2 Center** is designed with privacy and security as top priorities:

- **100% Open Source:** All code (frontend UI, backend Electron main process, and build scripts) is publicly readable in this repository.
- **Zero Telemetry / Zero Data Harvesting:** The app does not track your personal data, collect system analytics, or run non-essential background services. The only data it collects is your post match results containing: The server you're playing on (so the same match isn't counted twice), the map played, the layer played, the two factions played, and the final ticket count.
- **Self-Buildable:** If you prefer not to run a pre-compiled binary, you can audit the source code and compile the `.exe` yourself using standard Node.js tools in under 2 minutes (`npm install && npm run build`).

### Verification & Virus Total Reports
Every official release is scanned prior to publication. You can verify the safety of our latest release below:

- **VirusTotal Scan:** [View Antivirus Report](https://www.virustotal.com/gui/file/1652340f0e3d2999fd07cfcc2347b78508deb500a1949d56613ce80239bc1492)
- **SHA-256 Hash:** `1652340F0E3D2999FD07CFCC2347B78508DEB500A1949D56613CE80239BC1492`

#### How to verify the file hash on Windows:
Open PowerShell and run the following command on your downloaded installer:
```powershell
Get-FileHash -Algorithm SHA256 "path\to\Squad.Command.Center.Setup.v1.0.3.exe"
```

## Build It Yourself

Want to compile the app from source? It's easy. The project is built using [Electron](https://www.electronjs.org/) and packaged with `electron-builder`.

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- [Git](https://git-scm.com/)

### Installation & Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/batman202012/Squad-Command-Center.git
   cd Squad-Command-Center
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   *(This will also trigger `electron-builder install-app-deps` via our postinstall script to ensure native modules like sharp match your Electron version).*

3. **Run the app in development mode:**
   ```bash
   npm start
   ```

### Packaging for Windows
To build a standalone `.exe` installer (NSIS) for Windows:

```bash
npm run build
```
Once complete, you will find a lightweight `Squad C2 Center Setup 1.0.3.exe` file inside the `dist/` directory, ready to be distributed.

### ⚠️ Developer Map Assets
To keep this repository lightweight, the 8.6 GB of raw high-resolution map tiles are not included in this repo. If you want to build the app with local tiles exactly as I did, download the raw map assets here:

[Download Full Workspace Assets (.7z) - 8.6 GB](https://maps.tpun.online/squad-c2-maps-workspace.7z)

[Download SDK Extraction tools (.7z) - 181 MB](https://maps.tpun.online/sdk_extraction_tools.7z)

**Instructions:**
1. Download and extract the `.7z`.
2. Merge the extracted `maps` folder into your local `assets/maps/` directory.
3. You now have the exact 1:1 development environment!

## Acknowledgments & Credits

This project stands on the shoulders of some incredible community resources. Huge thanks to the following creators and communities:

*   **[squadcalc.app](https://squadcalc.app)**:
For creating such high-resolution topographic maps with easy to understand colors and contour lines used in our mapping engine.
*   **[SquadMaps.com](https://squadmaps.com)**: For generating and providing the high-resolution map tiles, and heightmaps used in our mapping engine.
*   **[Squad-Armor.com](https://squad-armor.com)**: For their incredible web-based 3D armor models, which this app links directly into for the Armor Viewer component.
*   **[The Official Squad Wiki](https://squad.fandom.com/wiki/Squad_Wiki)**: For providing tactical, faction, and UI icons used throughout the application. 
*   **[Squad Browser](https://squadbrowser.app/)**: For providing a highly functional server browser, which this app links directly into for people with issues with the current in-game browser.

## License

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**. 

The app is, and always will be, 100% free, open-source, and devoid of paywalls, premium features, or commercialization. The GPLv3 license ensures that anyone can use, modify, and distribute this software, provided that any modified versions are also made completely open-source and free under the exact same terms.

## Support the Project

I built this app for the love of the game and to help the community. There is absolutely zero expectation of making money from this project. 

However, hosting the high-resolution map tiles on a home Unraid server and keeping the domain alive does cost money. If you find the tool useful and want to drop a few bucks in the tip jar to help keep the lights on, you can buy me a coffee here:

**[☕ Buy Me a Coffee on Ko-fi](https://ko-fi.com/Nado0)**

*(Any tips go directly toward paying the server electric bill, domain renewals, and keeping me caffeinated while writing code!)*
