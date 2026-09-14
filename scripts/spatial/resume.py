"""Resume only an unchanged, hash-verified generated scene through the trusted runner."""
import argparse
import json
import platform
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).parent))
from png_validation import complete_png


parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
output = Path(args.output)
config = json.loads((output / 'render-config.json').read_text())
payload = json.loads((output / 'scene-data.json').read_text())
scene = bpy.context.scene
assert scene.frame_end == len(payload['cameraSamples'])
assert scene.render.resolution_x == 1920 and scene.render.resolution_y == 1080
assert scene.cycles.samples == config['samples']
assert scene.render.engine == ('CYCLES' if config['engine'] == 'cycles' else 'BLENDER_EEVEE_NEXT')
if config['device'] == 'auto' and platform.system() == 'Darwin' and config['engine'] == 'cycles':
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'METAL'
    preferences.get_devices()
    if any(device.type == 'METAL' for device in preferences.devices):
        for device in preferences.devices:
            device.use = device.type == 'METAL'
        scene.cycles.device = 'GPU'
scene.render.use_persistent_data = True
scene.render.resolution_percentage = 100
if config['mode'] in ('preview', 'film'):
    (output / 'previews').mkdir(exist_ok=True)
    for frame in sorted(set([1, *[round((scene.frame_end-1)*fraction)+1 for fraction in (.2, .4, .6, .8, 1)]])):
        target = output / 'previews' / f'frame-{frame:04d}.png'
        if not complete_png(target, (633, 356)):
            scene.render.resolution_percentage = 33
            scene.frame_set(frame)
            scene.render.filepath = str(target)
            bpy.ops.render.render(write_still=True)
scene.render.resolution_percentage = 100
if config['mode'] == 'film':
    (output / 'frames').mkdir(exist_ok=True)
    for frame in range(1, scene.frame_end + 1):
        target = output / 'frames' / f'frame-{frame:04d}.png'
        if not complete_png(target, (1920, 1080)):
            scene.frame_set(frame)
            scene.render.filepath = str(target)
            bpy.ops.render.render(write_still=True)
        print('GRIHAGRID_PROGRESS ' + json.dumps({'stage': 'frame', 'frame': frame, 'total': scene.frame_end}), flush=True)
