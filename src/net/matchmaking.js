// Finding games without a backend.
// Private rooms: the host takes the peer id "<prefix>-p-<CODE>".
// Quick Play: hosts take one of a few well-known slot ids per mode; joiners
// ask every slot for its state and pick the fullest room that's still open.
import { HAS_RELAY, PREFIX, connect, openPeer } from './transport.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SLOTS = 8;

export const roomCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const privateId = (code) => `${PREFIX}-p-${code}`;
const slotId = (mode, i) => `${PREFIX}-q-${mode}-${i}`;

export async function hostPrivate() {
  for (let i = 0; i < 5; i++) {
    const code = roomCode();
    try {
      return { peer: await openPeer(privateId(code)), code };
    } catch (e) {
      if (e.type !== 'unavailable-id') throw e;
    }
  }
  throw new Error('Could not create a room, try again.');
}

export async function joinPrivate(code) {
  const peer = await openPeer();
  try {
    const link = await connect(peer, privateId(code.toUpperCase()));
    return { peer, link };
  } catch (e) {
    peer.destroy();
    if (e.message === 'unavailable') throw new Error(`No room with code ${code}. Check the code, or the host may have left.`);
    if (e.message === 'timeout') {
      const i = e.info ?? {};
      const list = (set) => [...(set ?? [])].join(', ') || 'nothing';
      throw new Error([
        `Found room ${code}, but couldn’t connect to the host.`,
        `Host answered: ${i.answered ? 'yes' : 'no'} · steps: ${i.steps?.join(' → ') || 'none'}`,
        `This computer offered: ${list(i.mine)} · host offered: ${list(i.theirs)}${HAS_RELAY ? '' : ' · no relay set up'}`,
      ].join('\n'));
    }
    throw new Error(e.message);
  }
}

// Ask a host for its state: resolves { link, info }, { failed: true } when a
// room is there but we couldn't connect to it, or null when there's no room.
function probe(peer, id) {
  return connect(peer, id, 8000).then((link) => new Promise((resolve) => {
    const t = setTimeout(() => { link.close(); resolve({ failed: true }); }, 3000);
    link.onData((m) => {
      if (m.t !== 'info') return;
      clearTimeout(t);
      resolve({ link, info: m });
    });
    link.send({ t: 'probe' });
  })).catch((e) => (e.message === 'unavailable' ? null : { failed: true }));
}

const isOpen = (f) => f?.info && (f.info.state === 'waiting' || f.info.state === 'countdown') && f.info.players < f.info.max;

// Returns { role: 'client', peer, link } or { role: 'host', peer, slot, unreachable }
// (unreachable: rooms that exist but we couldn't connect to).
export async function quickPlay(mode, onStatus) {
  onStatus?.('Looking for a game…');
  const peer = await openPeer();
  const all = await Promise.all(Array.from({ length: SLOTS }, (_, i) => probe(peer, slotId(mode, i))));
  const found = all.filter((f) => f?.link);
  const unreachable = all.filter((f) => f?.failed).length;
  const open = found.filter(isOpen);
  open.sort((a, b) => b.info.players - a.info.players);
  for (const f of found) if (f !== open[0]) f.link.close();
  if (open[0]) return { role: 'client', peer, link: open[0].link };

  peer.destroy();
  onStatus?.(unreachable ? 'Found a game but couldn’t connect to it. Starting a new one…' : 'No open games. Starting a new one…');
  for (let i = 0; i < SLOTS; i++) {
    try {
      return { role: 'host', peer: await openPeer(slotId(mode, i)), slot: i, unreachable };
    } catch (e) {
      if (e.type !== 'unavailable-id') throw e;
    }
  }
  throw new Error('All public rooms are busy. Try a private room!');
}

// Two players pressing PLAY at the same moment both find nothing and both
// start a room. A host still alone in its room asks the rooms in lower slots
// (using its own peer) whether one is open; returns that slot or -1. Rooms
// only ever move down, and slot 0 never moves, so two rooms can't swap.
export async function findRoomBelow(peer, mode, below) {
  const all = await Promise.all(Array.from({ length: below }, (_, i) => probe(peer, slotId(mode, i))));
  let best = -1;
  all.forEach((f, i) => {
    if (!isOpen(f)) return;
    if (best < 0 || f.info.players > all[best].info.players) best = i;
  });
  for (const f of all) f?.link?.close();
  return best;
}

// Join the room in a Quick Play slot with a fresh peer: { peer, link }.
export async function joinSlot(mode, slot) {
  const peer = await openPeer();
  try {
    return { peer, link: await connect(peer, slotId(mode, slot)) };
  } catch (e) {
    peer.destroy();
    throw e;
  }
}
