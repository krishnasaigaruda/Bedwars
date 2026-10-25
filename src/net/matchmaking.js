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

// Ask a host for its state: resolves { link, info } or null.
function probe(peer, id) {
  return connect(peer, id, 8000).then((link) => new Promise((resolve) => {
    const t = setTimeout(() => { link.close(); resolve(null); }, 3000);
    link.onData((m) => {
      if (m.t !== 'info') return;
      clearTimeout(t);
      resolve({ link, info: m });
    });
    link.send({ t: 'probe' });
  })).catch(() => null);
}

// Returns { role: 'client', peer, link } or { role: 'host', peer, slot }.
export async function quickPlay(mode, onStatus) {
  onStatus?.('Looking for a game…');
  const peer = await openPeer();
  const found = (await Promise.all(Array.from({ length: SLOTS }, (_, i) => probe(peer, slotId(mode, i))))).filter(Boolean);
  const open = found.filter((f) => (f.info.state === 'waiting' || f.info.state === 'countdown') && f.info.players < f.info.max);
  open.sort((a, b) => b.info.players - a.info.players);
  for (const f of found) if (f !== open[0]) f.link.close();
  if (open[0]) return { role: 'client', peer, link: open[0].link };

  peer.destroy();
  onStatus?.('No open games. Starting a new one…');
  for (let i = 0; i < SLOTS; i++) {
    try {
      return { role: 'host', peer: await openPeer(slotId(mode, i)), slot: i };
    } catch (e) {
      if (e.type !== 'unavailable-id') throw e;
    }
  }
  throw new Error('All public rooms are busy. Try a private room!');
}
