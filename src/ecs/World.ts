/**
 * A small, TS-friendly ECS core (see docs/research/ecs-architecture.md).
 *
 * Deliberately minimal: archetype-free, one `Map<EntityId, T>` per component
 * type. At our scale (hundreds of entities) the GPU is the bottleneck, not
 * component iteration, so this favours simplicity over Bevy's storage tricks.
 * Pure and Three-free — components are plain data; the render layer keeps its
 * `THREE.Object3D` in a `RenderMesh` component that only render systems read —
 * so logic systems stay node-unit-testable.
 */
export type EntityId = number;

export interface Component<T> {
  readonly key: number;
  readonly name: string;
  /** Phantom for type inference only; never assigned. */
  readonly _t?: T;
}

let nextComponentKey = 0;

/** Declare a component type. The returned handle is used to add/get/query it. */
export function defineComponent<T>(name: string): Component<T> {
  return { key: nextComponentKey++, name };
}

export type Stage = 'startup' | 'update' | 'render';
export type System = (world: World, dt: number) => void;

export class World {
  private nextEntity: EntityId = 1;
  private readonly freeIds: EntityId[] = [];
  private readonly alive = new Set<EntityId>();
  private readonly stores = new Map<number, Map<EntityId, unknown>>();
  private readonly resources = new Map<string, unknown>();
  private readonly systems: Record<Stage, System[]> = { startup: [], update: [], render: [] };

  // --- entities ---
  create(): EntityId {
    const id = this.freeIds.pop() ?? this.nextEntity++;
    this.alive.add(id);
    return id;
  }

  destroy(e: EntityId): void {
    if (!this.alive.delete(e)) return;
    for (const store of this.stores.values()) store.delete(e);
    this.freeIds.push(e);
  }

  isAlive(e: EntityId): boolean {
    return this.alive.has(e);
  }

  entityCount(): number {
    return this.alive.size;
  }

  // --- components ---
  private store<T>(c: Component<T>): Map<EntityId, T> {
    let s = this.stores.get(c.key) as Map<EntityId, T> | undefined;
    if (!s) {
      s = new Map<EntityId, T>();
      this.stores.set(c.key, s as Map<EntityId, unknown>);
    }
    return s;
  }

  add<T>(e: EntityId, c: Component<T>, value: T): T {
    this.store(c).set(e, value);
    return value;
  }

  get<T>(e: EntityId, c: Component<T>): T | undefined {
    return this.store(c).get(e);
  }

  has<T>(e: EntityId, c: Component<T>): boolean {
    return this.store(c).has(e);
  }

  remove<T>(e: EntityId, c: Component<T>): void {
    this.store(c).delete(e);
  }

  /** Entities that have ALL of the given components. */
  query(...components: Component<unknown>[]): EntityId[] {
    if (components.length === 0) return [];
    // Iterate the smallest store, filter by the rest.
    const stores = components.map((c) => this.store(c));
    let smallest = stores[0];
    for (const s of stores) if (s.size < smallest.size) smallest = s;
    const out: EntityId[] = [];
    outer: for (const e of smallest.keys()) {
      for (const s of stores) if (s !== smallest && !s.has(e)) continue outer;
      out.push(e);
    }
    return out;
  }

  // --- resources (singletons) ---
  setResource<T>(key: string, value: T): void {
    this.resources.set(key, value);
  }

  getResource<T>(key: string): T | undefined {
    return this.resources.get(key) as T | undefined;
  }

  /** Get a resource that must exist, or throw (catches wiring mistakes early). */
  resource<T>(key: string): T {
    const v = this.resources.get(key);
    if (v === undefined) throw new Error(`ECS resource "${key}" is not set`);
    return v as T;
  }

  // --- systems / scheduling ---
  addSystem(stage: Stage, system: System): void {
    this.systems[stage].push(system);
  }

  runStartup(): void {
    for (const s of this.systems.startup) s(this, 0);
  }

  /** Fixed-timestep simulation stage. */
  update(dt: number): void {
    for (const s of this.systems.update) s(this, dt);
  }

  /** Per-frame presentation stage; `alpha` is the interpolation factor. */
  render(alpha: number): void {
    for (const s of this.systems.render) s(this, alpha);
  }
}
