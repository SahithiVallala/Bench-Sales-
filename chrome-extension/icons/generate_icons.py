"""
Run this script once to generate placeholder icons.
Requires: pip install Pillow
"""
try:
    from PIL import Image, ImageDraw, ImageFont

    def make_icon(size, path):
        img = Image.new('RGBA', (size, size), (99, 102, 241, 255))  # Indigo
        draw = ImageDraw.Draw(img)

        # Draw white circle
        margin = size // 6
        draw.ellipse(
            [margin, margin, size - margin, size - margin],
            fill=(255, 255, 255, 60)
        )

        # Draw "A" letter
        font_size = int(size * 0.5)
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

        text = "A"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        x = (size - tw) // 2
        y = (size - th) // 2
        draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)

        img.save(path, 'PNG')
        print(f"Created {path}")

    import os
    os.makedirs(os.path.dirname(__file__), exist_ok=True)
    make_icon(16,  'icon16.png')
    make_icon(48,  'icon48.png')
    make_icon(128, 'icon128.png')
    print("Icons generated successfully!")

except ImportError:
    print("Pillow not installed. Run: pip install Pillow")
    print("Or use any 16x16, 48x48, 128x128 PNG images as icons.")
