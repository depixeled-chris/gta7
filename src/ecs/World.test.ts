import { describe, it, expect } from 'vitest';
import { World, defineComponent } from './World';

interface Pos { x: number; z: number }
const Position = defineComponent<Pos>('Position');
const Velocity = defineComponent<{ vx: number }>('Velocity');
const Tag = defineComponent<true>('Tag');

describe('World entities', () => {
  it('creates unique ids and recycles destroyed ones', () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    expect(a).not.toBe(b);
    expect(w.entityCount()).toBe(2);
    w.destroy(a);
    expect(w.isAlive(a)).toBe(false);
    expect(w.entityCount()).toBe(1);
    const c = w.create();
    expect(c).toBe(a); // recycled
  });

  it('destroying an entity drops all its components', () => {
    const w = new World();
    const e = w.create();
    w.add(e, Position, { x: 1, z: 2 });
    w.destroy(e);
    expect(w.get(e, Position)).toBeUndefined();
    expect(w.query(Position)).not.toContain(e);
  });
});

describe('World components', () => {
  it('adds, gets, has, removes', () => {
    const w = new World();
    const e = w.create();
    w.add(e, Position, { x: 3, z: 4 });
    expect(w.has(e, Position)).toBe(true);
    expect(w.get(e, Position)).toEqual({ x: 3, z: 4 });
    w.remove(e, Position);
    expect(w.has(e, Position)).toBe(false);
    expect(w.get(e, Position)).toBeUndefined();
  });
});

describe('World query', () => {
  it('returns only entities that have ALL listed components', () => {
    const w = new World();
    const both = w.create();
    w.add(both, Position, { x: 0, z: 0 });
    w.add(both, Velocity, { vx: 1 });
    const posOnly = w.create();
    w.add(posOnly, Position, { x: 5, z: 5 });
    const velOnly = w.create();
    w.add(velOnly, Velocity, { vx: 2 });

    const movers = w.query(Position, Velocity);
    expect(movers).toEqual([both]);
    expect(w.query(Position).sort()).toEqual([both, posOnly].sort());
  });

  it('supports tag components and reflects live membership', () => {
    const w = new World();
    const e = w.create();
    w.add(e, Tag, true);
    expect(w.query(Tag)).toEqual([e]);
    w.remove(e, Tag);
    expect(w.query(Tag)).toEqual([]);
  });
});

describe('World resources', () => {
  it('stores and retrieves singletons; throws when a required one is missing', () => {
    const w = new World();
    w.setResource('dt', 0.016);
    expect(w.getResource<number>('dt')).toBe(0.016);
    expect(w.resource<number>('dt')).toBe(0.016);
    expect(() => w.resource('nope')).toThrow();
  });
});

describe('World scheduler', () => {
  it('runs systems per stage in registration order', () => {
    const w = new World();
    const log: string[] = [];
    w.addSystem('update', () => log.push('u1'));
    w.addSystem('update', () => log.push('u2'));
    w.addSystem('render', () => log.push('r1'));
    w.addSystem('startup', () => log.push('s1'));

    w.runStartup();
    w.update(0.016);
    w.render(0.5);
    expect(log).toEqual(['s1', 'u1', 'u2', 'r1']);
  });

  it('passes dt to update systems and alpha to render systems', () => {
    const w = new World();
    let seenDt = 0;
    let seenAlpha = 0;
    w.addSystem('update', (_, dt) => (seenDt = dt));
    w.addSystem('render', (_, alpha) => (seenAlpha = alpha));
    w.update(0.02);
    w.render(0.75);
    expect(seenDt).toBe(0.02);
    expect(seenAlpha).toBe(0.75);
  });
});
