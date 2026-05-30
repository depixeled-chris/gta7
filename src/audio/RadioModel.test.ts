import { describe, it, expect } from 'vitest';
import { RadioModel, type RadioStation } from './RadioModel';

const stations: RadioStation[] = [
  { name: 'A', tracks: [{ title: 'a1', url: 'a1' }, { title: 'a2', url: 'a2' }] },
  { name: 'B', tracks: [{ title: 'b1', url: 'b1' }] },
];

describe('RadioModel', () => {
  it('starts off', () => {
    const r = new RadioModel(stations);
    expect(r.isOn).toBe(false);
    expect(r.current()).toBeNull();
  });

  it('cycles forward OFF -> A -> B -> OFF', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1);
    expect(r.current()?.station).toBe('A');
    r.cycleStation(1);
    expect(r.current()?.station).toBe('B');
    r.cycleStation(1);
    expect(r.current()).toBeNull(); // back to off
  });

  it('cycles backward OFF -> B -> A -> OFF', () => {
    const r = new RadioModel(stations);
    r.cycleStation(-1);
    expect(r.current()?.station).toBe('B');
    r.cycleStation(-1);
    expect(r.current()?.station).toBe('A');
    r.cycleStation(-1);
    expect(r.current()).toBeNull();
  });

  it('resets to the first track when switching stations', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1); // A
    r.nextTrack();
    expect(r.current()?.track.title).toBe('a2');
    r.cycleStation(1); // B
    expect(r.trackIndex).toBe(0);
    expect(r.current()?.track.title).toBe('b1');
  });

  it('wraps tracks within a station', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1); // A (2 tracks)
    r.nextTrack();
    expect(r.current()?.track.title).toBe('a2');
    r.nextTrack();
    expect(r.current()?.track.title).toBe('a1');
  });

  it('does nothing with no stations', () => {
    const r = new RadioModel([]);
    r.cycleStation(1);
    expect(r.current()).toBeNull();
  });

  it('peeks the next track url and wraps', () => {
    const r = new RadioModel(stations);
    expect(r.peekNextUrl()).toBeNull(); // off
    r.cycleStation(1); // A, track a1
    expect(r.peekNextUrl()).toBe('a2');
    r.nextTrack(); // a2
    expect(r.peekNextUrl()).toBe('a1'); // wraps
  });

  it('setTrack drops onto a wrapped index', () => {
    const r = new RadioModel(stations);
    r.cycleStation(1); // A (2 tracks)
    r.setTrack(3); // 3 % 2 = 1
    expect(r.current()?.track.title).toBe('a2');
    r.setTrack(-1); // wraps to 1
    expect(r.current()?.track.title).toBe('a2');
  });
});
