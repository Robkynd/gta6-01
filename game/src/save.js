// Neon Bay save: one localStorage slot for Rex's cash, mission progress,
// position and health. Every call is guarded — localStorage can throw.

const KEY = 'neon-bay-save-v1';

export function createSave() {
  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  return {
    hasSave() { return load() !== null; },
    load,
    save(data) {
      try {
        const snapshot = {
          cash: data.cash ?? 0,
          missionIndex: data.missionIndex ?? 0,
          x: data.x ?? 0,
          z: data.z ?? 0,
          health: data.health ?? 100,
        };
        window.localStorage.setItem(KEY, JSON.stringify(snapshot));
        return true;
      } catch (e) {
        return false;
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(KEY);
      } catch (e) {
        // Storage unavailable — nothing to clear.
      }
    },
  };
}
