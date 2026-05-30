import { describe, it, expect } from 'vitest';
import { RadioModel, type RadioStation } from './RadioModel';

const stations: RadioStation[] = [
  { name: 'A', tracks: [
    { title: 'a1', url: 'a1' },
    { title: 'a2', url: 'a2' },
    { title: 'a3', url: 'a3' },
  ] },
  { name: 'B', tracks: [{ title: 'b1', url: 'b1' }] },
];

describe('RadioModel', () => {
  it('starts off', () => {
    const r = new RadioModel(stations);
    expect(r.isOn).toBe(false);
    expect(r.current()).toBeNull();
  });

  it('cycles forward OFF -> A -> B -> OFF and backward', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1);
    expect(r.current()?.station).toBe('A');
    r.cycleStation(1);
    expect(r.current()?.station).toBe('B');
    r.cycleStation(1);
    expect(r.current()).toBeNull();
    r.cycleStation(-1);
    expect(r.current()?.station).toBe('B');
  });

  it('plays every track in a station once before any repeats (shuffle)', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1); // station A, 3 tracks
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      seen.add(r.current()!.track.title);
      r.nextTrack();
    }
    expect(seen).toEqual(new Set(['a1', 'a2', 'a3']));
  });

  it('never plays the same track twice in a row across reshuffles', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1); // A
    let prev = r.current()!.track.title;
    for (let i = 0; i < 60; i++) {
      r.nextTrack();
      const cur = r.current()!.track.title;
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });

  it('handles a single-track station without error', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1);
    r.cycleStation(1); // B, 1 track
    expect(r.current()?.track.title).toBe('b1');
    r.nextTrack();
    expect(r.current()?.track.title).toBe('b1');
  });

  it('peekNextUrl predicts the upcoming track', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1); // A
    const peek = r.peekNextUrl();
    expect(peek).not.toBeNull();
    r.nextTrack();
    expect(r.current()!.track.url).toBe(peek);
  });

  it('tuneInRandom lands on a valid in-range track', () => {
    const r = new RadioModel(stations, () => 0.99);
    r.cycleStation(1); // A
    r.tuneInRandom();
    expect(r.isOn).toBe(true);
    expect(r.trackIndex).toBeGreaterThanOrEqual(0);
    expect(r.trackIndex).toBeLessThan(3);
  });

  it('tuneTo jumps to a specific station (clamped)', () => {
    const r = new RadioModel(stations);
    r.tuneTo(1);
    expect(r.current()?.station).toBe('B');
    r.tuneTo(99); // clamped to the last station
    expect(r.current()?.station).toBe('B');
    r.tuneTo(0);
    expect(r.current()?.station).toBe('A');
  });

  it('does nothing with no stations', () => {
    const r = new RadioModel([]);
    r.cycleStation(1);
    expect(r.current()).toBeNull();
    r.nextTrack();
    expect(r.current()).toBeNull();
  });
});
