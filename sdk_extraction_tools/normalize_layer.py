import json
import re
import os
import glob

def process_layer(input_file, output_file):
    with open(input_file, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError:
            print(f"⚠️ Skipping {os.path.basename(input_file)}: Invalid JSON format.")
            return

    raw_flags = data.get("flags", [])
    if not raw_flags: return

    final_flags = []
    merged_flags = {}
    sky_nodes = []

    # Pass 1: Catalog Sky Nodes & Build Base Named Flags
    for flag in raw_flags:
        name = flag.get("name", "")
        lower_name = name.lower().strip()

        # Pass-through items (Mains, SM_, etc.)
        is_excluded = (
            "main" in lower_name or
            lower_name.startswith("sm_") or
            lower_name.startswith("flag") or
            lower_name.startswith("caf") or
            lower_name.startswith("horizontal") or
            "destroyable" in lower_name or
            "objectivespawn" in lower_name
        )

        if is_excluded:
            # Clean up the output JSON by removing our custom scanner tags
            if "is_sky_node" in flag: del flag["is_sky_node"]
            if "linked_flags" in flag: del flag["linked_flags"]
            final_flags.append(flag)
            continue

        # If it is an invisible Capture Zone, it is a graph node in the sky
        if "capture zone" in lower_name:
            sky_nodes.append(flag)
            continue

        # It's a valid physical Named Flag on the ground, build its object
        base_name = re.sub(r'\s*\d+$', '', name).strip()

        if base_name not in merged_flags:
            merged_flags[base_name] = {
                "name": base_name,
                "x": flag.get("x"),
                "y": flag.get("y"),
                "z": flag.get("z", 0),
                "phases": [],
                "phase_labels": []
            }
        
        # Inherit the manual phases if OWI typed them natively on the ground flag
        order = flag.get("order", 0)
        lane = flag.get("lane", "ANY").strip()
        
        if order > 0:
            phase_label = f"{order}{lane}"
            if phase_label not in merged_flags[base_name]["phase_labels"]:
                merged_flags[base_name]["phases"].append({"order": order, "lane": lane})
                merged_flags[base_name]["phase_labels"].append(phase_label)

    # Pass 2: THE HOLY GRAIL (Exact Graph Mapping via Linked Blueprint Arrays)
    for sky in sky_nodes:
        sky_order = sky.get("order", 0)
        sky_lane = sky.get("lane", "ANY").strip()
        
        if sky_order <= 0: continue

        for link in sky.get("linked_flags", []):
            # Clean OWI's messy string prefix (e.g., "A1-Rice Farm" -> "Rice Farm")
            if "-" in link:
                clean_link = link.split("-", 1)[-1].strip()
            else:
                clean_link = link.strip()
            
            clean_link = clean_link.replace("BP_", "").strip()
            base_link = re.sub(r'\s*\d+$', '', clean_link).strip()

            # Exact 1:1 Mapping! No math, no distances, no guessing.
            if base_link in merged_flags:
                phase_label = f"{sky_order}{sky_lane}"
                if phase_label not in merged_flags[base_link]["phase_labels"]:
                    merged_flags[base_link]["phases"].append({"order": sky_order, "lane": sky_lane})
                    merged_flags[base_link]["phase_labels"].append(phase_label)
            else:
                # Fallback fuzzy match just in case OWI had a typo between the outliner and the array
                for gb_name in merged_flags.keys():
                    if base_link.lower() in gb_name.lower() or gb_name.lower() in base_link.lower():
                        phase_label = f"{sky_order}{sky_lane}"
                        if phase_label not in merged_flags[gb_name]["phase_labels"]:
                            merged_flags[gb_name]["phases"].append({"order": sky_order, "lane": sky_lane})
                            merged_flags[gb_name]["phase_labels"].append(phase_label)

    # Combine processed flags into the final output array
    for base_name, flag_data in merged_flags.items():
        # Only keep flags that actually have a phase assigned. 
        if len(flag_data["phases"]) > 0:
            final_flags.append(flag_data)

    data["flags"] = final_flags
    data["total_flags"] = len(final_flags)

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

    print(f"✅ Processed: {os.path.basename(input_file)} ({len(raw_flags)} -> {len(final_flags)} flags)")

def main():
    input_dir = 'input_layers'
    output_dir = 'normalized_layers'

    if not os.path.exists(input_dir):
        os.makedirs(input_dir)
        print(f"📁 Created '{input_dir}' directory. Please put your raw JSON files in here and run again.")
        return
        
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    json_files = glob.glob(os.path.join(input_dir, '*.json'))
    
    if not json_files:
        print(f"⚠️ No JSON files found in the '{input_dir}' folder.")
        return

    print(f"🔍 Found {len(json_files)} files. Starting exact blueprint graph normalization...\n")

    for input_path in json_files:
        filename = os.path.basename(input_path)
        output_path = os.path.join(output_dir, filename)
        process_layer(input_path, output_path)
        
    print(f"\n🎉 Batch complete! All files safely mapped and saved to '{output_dir}'.")

if __name__ == "__main__":
    main()