"""Reusable scene assembly. All input is validated data, never executable code."""
import math
import bpy
from mathutils import Vector


def linear_rgb(hex_color):
    rgb = [int(hex_color.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb)


def material_for(primitive, materials):
    color = primitive.get('color', '#ddd1bc')
    name = primitive.get('material', 'plaster')
    key = f'{name}:{color}'
    if key in materials:
        return materials[key]
    material = bpy.data.materials.new(key)
    material.diffuse_color = (*linear_rgb(color), 1)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = material.diffuse_color
    bsdf.inputs['Roughness'].default_value = .42 if 'wood' in name else .72
    if 'glass' in name:
        bsdf.inputs['Transmission Weight'].default_value = .8
        bsdf.inputs['Roughness'].default_value = .08
        material.diffuse_color = (*linear_rgb(color), .35)
    materials[key] = material
    return material


def build_scene(payload):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    materials = {}
    for item in payload['primitives']:
        kind = item['kind']
        if kind == 'box':
            bpy.ops.mesh.primitive_cube_add(size=1)
        elif kind == 'cylinder':
            bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=.5, depth=1)
        elif kind == 'sphere':
            bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=.5)
        else:
            raise ValueError(f'Unsupported primitive kind: {kind}')
        obj = bpy.context.object
        obj.name = item['id']
        obj.location = Vector(item['position']) / 1000
        obj.dimensions = Vector(item['size']) / 1000
        obj.rotation_euler.z = item.get('rotation', 0)
        obj.data.materials.append(material_for(item, materials))
        for key in ('id', 'roomId', 'category', 'collidable'):
            if item.get(key) is not None:
                obj[key] = item[key]
        obj['sourceRevision'] = payload['sourceRevision']
        if kind != 'box':
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
        if kind == 'box' and min(item['size']) >= 60:
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            bevel = obj.modifiers.new('Subtle edge highlight', 'BEVEL')
            bevel.width = .008
            bevel.segments = 2
            bevel.affect = 'EDGES'

    world = bpy.data.worlds.new('GrihaGrid afternoon')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.70, .79, 1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .45
    scene.world = world
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 12))
    sun = bpy.context.object
    sun.name = 'Afternoon sun'
    sun.rotation_euler = (math.radians(28), math.radians(-22), math.radians(-25))
    sun.data.energy = 2.5
    sun.data.angle = math.radians(10)
    for room in payload.get('rooms', []):
        points = room['polygon']
        center = [sum(p[i] for p in points) / len(points) / 1000 for i in (0, 1)]
        bpy.ops.object.light_add(type='AREA', location=(*center, 2.72))
        light = bpy.context.object
        light.name = f"{room['id']}:ceiling-light"
        light.data.energy = 120
        light.data.shape = 'DISK'
        light.data.size = 1.8
        light.data.color = (1, .83, .65)
    scene.view_settings.view_transform = 'AgX'
    return scene


def mesh_bounds(obj):
    points = [obj.matrix_world @ Vector(point) for point in obj.bound_box]
    return {
        'min': [min(p[i] for p in points) * 1000 for i in range(3)],
        'max': [max(p[i] for p in points) * 1000 for i in range(3)],
    }


def scene_manifest(payload):
    bpy.context.view_layer.update()
    objects = []
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and 'id' in obj:
            objects.append({
                'id': obj['id'], 'roomId': obj.get('roomId'),
                'category': obj.get('category'), 'boundsMm': mesh_bounds(obj),
            })
    return {
        'schemaVersion': 1, 'sourceRevision': payload['sourceRevision'],
        'canonicalAxes': 'X right, Y forward, Z up; millimetres',
        'gltfAxes': 'X right, Y up, Z backward; metres',
        'canonicalToGltf': '[x / 1000, z / 1000, -y / 1000]',
        'objects': objects, 'tour': payload['tour'],
    }
