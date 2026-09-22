// Enough of the Durable Object storage API for a Room to run under plain node:
// the key/value store it persists into, plus the alarm it keeps for its own
// lifetime (see room-lifetime.mjs). `store` is exposed so a test can watch what
// the room actually wrote, and survive a simulated eviction by handing the same
// store to a fresh Room.
export function fakeStorage(store = new Map()) {
  let alarmAt = null;
  return {
    store,
    get: async k => store.get(k),
    put: async (k, v) => void store.set(k, v),
    deleteAll: async () => store.clear(),
    getAlarm: async () => alarmAt,
    setAlarm: async t => { alarmAt = t; },
    deleteAlarm: async () => { alarmAt = null; },
  };
}
