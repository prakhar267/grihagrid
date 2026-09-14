"""Run only through the local job runner: blender --background --python render.py."""
import argparse
import json
from pathlib import Path
import sys
import time
import platform
import hashlib
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from scene import build_scene, mesh_bounds, scene_manifest
from cameras import build_camera, build_tour_fades


def progress(stage, **extra):
    print('GRIHAGRID_PROGRESS ' + json.dumps({'stage': stage, **extra}), flush=True)


def verify_roundtrip(glb_path, manifest, camera):
    original_forward = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    original_camera = camera.location.copy()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    bpy.context.view_layer.update()
    imported = {obj.get('id'): obj for obj in bpy.context.scene.objects if 'id' in obj}
    maximum_error = 0
    for expected in manifest['objects']:
        obj = imported.get(expected['id'])
        if obj is None:
            raise ValueError(f"GLB lost object identifier {expected['id']}")
        if obj.get('roomId') != expected['roomId']:
            raise ValueError(f"GLB lost room association {expected['id']}")
        if any(obj.get(key) != expected.get(key) for key in ('floorId', 'stairId', 'wallId', 'openingId')):
            raise ValueError(f"GLB lost a structural association {expected['id']}")
        actual = mesh_bounds(obj)
        for edge in ('min', 'max'):
            maximum_error = max(maximum_error, *[abs(a-b) for a, b in zip(actual[edge], expected['boundsMm'][edge])])
    if maximum_error > 1:
        raise ValueError(f'GLB round-trip bounds differ by {maximum_error} mm')
    restored_camera = imported.get('tour-camera')
    if restored_camera is None:
        raise ValueError('GLB lost tour camera')
    camera_error = (restored_camera.matrix_world.translation - original_camera).length * 1000
    direction = restored_camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    direction_error = (direction - original_forward).length
    if camera_error > 1 or direction_error > .0001:
        raise ValueError('GLB camera coordinate round trip failed')
    return {'passed': True, 'objectsChecked': len(manifest['objects']), 'maxBoundsErrorMm': maximum_error,
            'cameraPositionErrorMm': camera_error, 'cameraDirectionError': direction_error}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene-data', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--mode', choices=['scene', 'preview', 'film'], required=True)
    parser.add_argument('--samples', type=int, default=16)
    parser.add_argument('--device', choices=['auto', 'cpu'], default='auto')
    parser.add_argument('--engine', choices=['cycles', 'eevee'], default='cycles')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    output = Path(args.output)
    payload = json.loads(Path(args.scene_data).read_text())
    started = time.monotonic()
    progress('building', primitives=len(payload['primitives']))
    scene = build_scene(payload)
    camera = build_camera(payload)
    build_tour_fades(payload)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.denoising_use_gpu = True
    scene.cycles.denoising_prefilter = 'FAST'
    scene.cycles.denoising_quality = 'FAST'
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 2
    scene.cycles.glossy_bounces = 2
    render_device = 'CPU'
    if args.device == 'auto' and platform.system() == 'Darwin':
        preferences = bpy.context.preferences.addons['cycles'].preferences
        try:
            preferences.compute_device_type = 'METAL'
            preferences.get_devices()
            available = [device for device in preferences.devices if device.type == 'METAL']
            if available:
                for device in preferences.devices:
                    device.use = device.type == 'METAL'
                scene.cycles.device = 'GPU'
                render_device = 'Metal'
        except (RuntimeError, TypeError):
            pass
    if args.engine == 'eevee':
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
        scene.eevee.taa_render_samples = args.samples
        render_device = 'Eevee GPU'
    progress('render-device', device=render_device)
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.compression = 5
    scene.render.film_transparent = False
    scene.render.use_persistent_data = True
    blend_path = output / 'house.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    proof = {'blendSha256': hashlib.sha256(blend_path.read_bytes()).hexdigest(),
             'sourceSha256': hashlib.sha256(Path(args.scene_data).read_bytes()).hexdigest()}
    config = output / 'render-config.json'
    if config.exists():
        proof['recipeSha256'] = hashlib.sha256(config.read_bytes()).hexdigest()
    manifest = scene_manifest(payload)
    progress('exporting')
    glb_path = output / 'house.glb'
    # glTF carries the matching base colours; Cycles keeps procedural grain in .blend.
    for material in bpy.data.materials:
        if material.use_nodes:
            for link in list(material.node_tree.links):
                if link.to_node.type == 'BSDF_PRINCIPLED' and link.to_socket.name in ('Base Color', 'Normal'):
                    material.node_tree.links.remove(link)
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB',
                              export_extras=True, export_cameras=True,
                              export_lights=True, export_animations=False,
                              export_apply=True)
    manifest['roundTrip'] = verify_roundtrip(glb_path, manifest, camera)
    progress('roundtrip-verified', **manifest['roundTrip'])
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    # A resumable build includes verified exports, not only a saved .blend.
    proof['exportSha256'] = hashlib.sha256(glb_path.read_bytes()).hexdigest()
    (output / 'build-proof.json').write_text(json.dumps(proof))
    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    scene = bpy.context.scene
    if args.mode in ('preview', 'film'):
        previews = output / 'previews'
        previews.mkdir(exist_ok=True)
        scene.render.resolution_percentage = 33
        frames = sorted(set([1, *[round((len(payload['cameraSamples'])-1)*fraction)+1 for fraction in (.2, .4, .6, .8, 1)]]))
        for frame in frames:
            scene.frame_set(frame)
            scene.render.filepath = str(previews / f'frame-{frame:04d}.png')
            progress('preview-frame', frame=frame, total=scene.frame_end)
            bpy.ops.render.render(write_still=True)
    if args.mode == 'film':
        frames_dir = output / 'frames'
        frames_dir.mkdir(exist_ok=True)
        scene.render.resolution_percentage = 100
        scene.render.filepath = str(frames_dir / 'frame-')
        progress('film-frames', frames=scene.frame_end)
        def frame_written(scene):
            progress('frame', frame=scene.frame_current, total=scene.frame_end)
        bpy.app.handlers.render_write.append(frame_written)
        bpy.ops.render.render(animation=True)
    manifest['render'] = {'engine': 'Cycles' if args.engine == 'cycles' else 'Eevee', 'device': render_device, 'samples': args.samples, 'mode': args.mode,
                          'durationSeconds': len(payload['cameraSamples']) / payload['fps'],
                          'elapsedSeconds': round(time.monotonic() - started, 2)}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    progress('complete', elapsedSeconds=manifest['render']['elapsedSeconds'])


if __name__ == '__main__':
    main()
