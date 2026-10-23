import { BufferGeometry, Material, Mesh, Object3D, Texture } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collects every GPU resource and physics collider created for a scope (scene, chunk, entity)
 * so that a single `dispose()` call releases all of it. Nothing created for a chunk may bypass this.
 */
export class ResourceTracker {
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly textures = new Set<Texture>();
  private readonly roots = new Set<Object3D>();
  private readonly colliders = new Set<RAPIER.Collider>();
  private readonly bodies = new Set<RAPIER.RigidBody>();

  constructor(private readonly physics: RAPIER.World) {}

  geometry<T extends BufferGeometry>(g: T): T {
    this.geometries.add(g);
    return g;
  }

  material<T extends Material>(m: T): T {
    this.materials.add(m);
    for (const value of Object.values(m as unknown as Record<string, unknown>)) {
      if (value instanceof Texture) this.textures.add(value);
    }
    return m;
  }

  texture<T extends Texture>(t: T): T {
    this.textures.add(t);
    return t;
  }

  /** Tracks a scene-graph root plus every geometry/material found beneath it. */
  object<T extends Object3D>(root: T): T {
    this.roots.add(root);
    root.traverse((node) => {
      if (node instanceof Mesh) {
        this.geometry(node.geometry as BufferGeometry);
        const mats: Material[] = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) this.material(m);
      }
    });
    return root;
  }

  collider(c: RAPIER.Collider): RAPIER.Collider {
    this.colliders.add(c);
    return c;
  }

  body(b: RAPIER.RigidBody): RAPIER.RigidBody {
    this.bodies.add(b);
    return b;
  }

  dispose(): void {
    for (const r of this.roots) r.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    // Removing a body also removes its attached colliders; free stand-alone colliders first.
    for (const c of this.colliders) {
      if (c.parent() === null && this.physics.getCollider(c.handle)) this.physics.removeCollider(c, false);
    }
    for (const b of this.bodies) {
      if (this.physics.getRigidBody(b.handle)) this.physics.removeRigidBody(b);
    }
    this.roots.clear();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.colliders.clear();
    this.bodies.clear();
  }
}
