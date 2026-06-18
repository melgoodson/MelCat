import os
import glob
from PIL import Image

input_dir = r"C:\Users\Iris\Downloads\melcat gifs\GIF FORMAT"
output_dir = r"C:\Users\Iris\Downloads\melcat gifs\WEBP FORMAT"

os.makedirs(output_dir, exist_ok=True)

gif_files = glob.glob(os.path.join(input_dir, "*.gif"))

if not gif_files:
    print("No GIF files found!")
    exit(0)

print(f"Found {len(gif_files)} GIF files. Starting conversion to Animated WebP...")

for gif_path in gif_files:
    filename = os.path.basename(gif_path)
    base_name = os.path.splitext(filename)[0]
    output_path = os.path.join(output_dir, f"{base_name}.webp")
    
    print(f"Converting: {filename} ...")
    try:
        with Image.open(gif_path) as im:
            # We want to save all frames
            im.save(
                output_path,
                "WEBP",
                save_all=True,
                optimize=True,
                quality=80, # Adjust quality for compression
                method=4, # Compression effort (0-6)
                lossless=False # Lossy compression to drastically reduce size
            )
        
        # Check new size
        old_size = os.path.getsize(gif_path) / (1024 * 1024)
        new_size = os.path.getsize(output_path) / (1024 * 1024)
        print(f"  -> Done! Size reduced from {old_size:.2f} MB to {new_size:.2f} MB")
        
    except Exception as e:
        print(f"  -> Error converting {filename}: {e}")

print(f"\nAll done! You can find your optimized WebP files in:\n{output_dir}")
