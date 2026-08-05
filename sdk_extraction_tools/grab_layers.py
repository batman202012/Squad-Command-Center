import unreal
import json
import os
import re

# --- CONFIGURATION ---
output_directory = "D:/SquadMapData"

# List all virtual plugin package mount points you want to sweep. 
plugin_virtual_folders = [
    "/Al_Basrah/Maps",
    "/BlackCoast/Maps",
    "/Harju/Maps",
    "/SanxianIslands/Maps",
    "/Game/Maps"
]

if not os.path.exists(output_directory):
    os.makedirs(output_directory)

editor_asset_lib = unreal.EditorAssetLibrary()
level_lib = unreal.EditorLevelLibrary()
load_lib = unreal.EditorLoadingAndSavingUtils()

def mega_sweep_gameplay_layers():
    print("Waiting for Unreal Engine Asset Registry to finish scanning files (This may take a minute)...")
    asset_registry = unreal.AssetRegistryHelpers.get_asset_registry()
    asset_registry.wait_for_completion()
    print("Asset Registry Fully Loaded!")

    print("Scanning SDK across all plugin mount points for 'Gameplay_Layers'...")
    
    layer_paths = []
    
    for folder_path in plugin_virtual_folders:
        if editor_asset_lib.does_directory_exist(folder_path):
            print(f" -> Sweeping directory: {folder_path}")
            all_assets = editor_asset_lib.list_assets(folder_path, recursive=True, include_folder=False)
            
            for p in all_assets:
                path_str = str(p)
                # UE5 Asset paths sometimes append object types, stripping down to the base path
                if "Gameplay_Layers" in path_str or "Gameplay_layers" in path_str:
                    clean_path = path_str.split('.')[0]
                    if clean_path not in layer_paths:
                        layer_paths.append(clean_path)
        else:
            print(f" ⚠️ Skipping missing or unmounted folder path: {folder_path}")

    print(f"✅ Found {len(layer_paths)} Gameplay Layers across all plugins! Beginning Mega-Sweep...")

    for path in layer_paths:
        path_parts = path.split('/')
        layer_name = path_parts[-1]
        
        try:
            gl_index = [i for i, s in enumerate(path_parts) if "Gameplay" in s][0]
            base_map_name = path_parts[gl_index - 1]
        except Exception:
            base_map_name = layer_name.split('_')[0] 
        
        map_out_dir = os.path.join(output_directory, base_map_name.lower())
        if not os.path.exists(map_out_dir):
            os.makedirs(map_out_dir)

        output_path = os.path.join(map_out_dir, f"{layer_name}.json")
        if os.path.exists(output_path):
            print(f"⏭️ Skipping {layer_name}... JSON already exists.")
            continue 

        print(f"Loading {layer_name}...")
        
        success = load_lib.load_map(path)
        if not success:
            print(f"⚠️ Failed to load {layer_name}. Skipping.")
            continue
        
        capture_zones = level_lib.get_all_level_actors()
        flag_data = []

        for actor in capture_zones:
            actor_name = str(actor.get_name()).lower()
            actor_label = str(actor.get_actor_label())
            actor_class = str(actor.get_class().get_name()).lower()
            
            is_flag = False
            search_terms = ["capturezone", "flag", "cp_", "objective", "controlpoint", "aas_", "rallypoint"]
            
            for term in search_terms:
                if term in actor_name or term in actor_class or term in actor_label.lower():
                    is_flag = True
                    break

            if is_flag:
                location = actor.get_actor_location()
                
                flag_order = -1
                lane = "Any"
                clean_name = actor_label
                
                try:
                    flag_order = int(actor.get_editor_property("Order"))
                except Exception:
                    try:
                        flag_order = int(actor.get_editor_property("CaptureOrder"))
                    except Exception:
                        pass
                
                parts = actor_label.split('-', 1)
                if len(parts) == 2:
                    prefix = parts[0].upper()
                    raw_name = parts[1]
                    
                    if flag_order == -1:
                        num_match = re.search(r'(\d+)', prefix)
                        if num_match:
                            flag_order = int(num_match.group(1))
                            
                    lane_match = re.search(r'([A-Z]+)', prefix)
                    if lane_match and "Z" not in prefix:
                        lane = lane_match.group(1)
                        
                    clean_name = raw_name

                clean_name = clean_name.replace("BP_", "").replace("CaptureZoneCluster", "Capture Zone").replace("CaptureZone", "Capture Zone").strip()
                if clean_name == "":
                    clean_name = "Capture Zone"
                    
                if "Team1" in actor_label or "Team 1" in actor_label:
                    clean_name = "Team 1 Main"
                    flag_order = 0
                    lane = "Main"
                elif "Team2" in actor_label or "Team 2" in actor_label or "Z-Main" in actor_label:
                    clean_name = "Team 2 Main"
                    flag_order = 100
                    lane = "Main"

                # ==============================================================
                # --- UE5-SAFE SKY GRAPH DETECTOR ---
                # ==============================================================
                is_sky_node = False
                linked_targets = []

                if location.z > 2000: 
                    is_sky_node = True
                    
                    # 1. Check if the ground flags are attached in the outliner
                    for attached in actor.get_attached_actors():
                        if hasattr(attached, 'get_actor_label'):
                            linked_targets.append(attached.get_actor_label())

                    # 2. Use Unreal Reflection to brute-force common OWI array property names
                    for prop in ["CapturePoints", "Objectives", "Flags", "ControlPoints", "Nodes", "Children", "CapturePoint", "Objective", "Flag", "ControlPoint", "Target"]:
                        try:
                            refs = actor.get_editor_property(prop)
                            if refs:
                                # Handles Python lists, sets, tuples, and UE5's native unreal.Array
                                if isinstance(refs, (list, set, tuple, unreal.Array)):
                                    for r in refs:
                                        if r and hasattr(r, 'get_actor_label'):
                                            linked_targets.append(r.get_actor_label())
                                        elif r and hasattr(r, 'get_name'):  # Fallback for soft references
                                            linked_targets.append(str(r.get_name()))
                                else:
                                    # Handle singular object references
                                    if hasattr(refs, 'get_actor_label'):
                                        linked_targets.append(refs.get_actor_label())
                                    elif hasattr(refs, 'get_name'):
                                        linked_targets.append(str(refs.get_name()))
                        except Exception:
                            pass

                flag_data.append({
                    "name": clean_name,
                    "lane": lane,
                    "order": flag_order,
                    "x": round(location.x, 2),
                    "y": round(location.y, 2),
                    "z": round(location.z, 2),
                    "is_sky_node": is_sky_node,
                    "linked_flags": list(set(linked_targets)) # Deduplicate array
                })

        flag_data = sorted(flag_data, key=lambda d: float('inf') if d['order'] == -1 else d['order'])

        with open(output_path, 'w') as outfile:
            json.dump({
                "map_id": base_map_name.lower(),
                "layer_name": layer_name,
                "total_flags": len(flag_data),
                "flags": flag_data
            }, outfile, indent=4)
            
        print(f"  -> Saved {len(flag_data)} flags.")
        
        unreal.SystemLibrary.collect_garbage()

    print("\n🎉 MEGA-SWEEP COMPLETE!")

mega_sweep_gameplay_layers()