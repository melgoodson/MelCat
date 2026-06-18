import os
import glob
from PIL import Image

input_dir = r"C:\Users\Iris\Downloads\melcat gifs\GIF FORMAT"
output_dir = r"C:\Users\Iris\Downloads\melcat gifs\WEBP FORMAT"

os.makedirs(output_dir, exist_ok=True)
gif_files = glob.glob(os.path.join(input_dir, "*.gif"))

print("Fixing durations...")

for gif_path in gif_files:
    filename = os.path.basename(gif_path)
    base_name = os.path.splitext(filename)[0]
    output_path = os.path.join(output_dir, f"{base_name}.webp")
    
    with Image.open(gif_path) as im:
        durations = []
        try:
            while True:
                durations.append(im.info.get('duration', 100))
                im.seek(im.tell() + 1)
        except EOFError:
            pass
            
        im.seek(0)
        
        im.save(
            output_path,
            "WEBP",
            save_all=True,
            optimize=True,
            quality=80,
            method=4,
            lossless=False,
            duration=durations,
            loop=0
        )
    print(f"Fixed {filename}")
