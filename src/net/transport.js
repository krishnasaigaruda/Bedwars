// Thin wrapper around PeerJS. The free PeerJS cloud server is only used to
// find each other; game traffic then goes browser-to-browser over WebRTC.
import { Peer } from 'peerjs';

export const PREFIX = 'bwfun1';

// Relay (TURN) servers, for players whose networks block a direct connection
// (common between two home networks, and with Windows firewalls). The free
// public relays (Open Relay, freeturn.net, ...) no longer answer, so this
// needs your own: a free metered.ca account gives one. Paste its entries here:
//   { urls: 'turn:global.relay.metered.ca:80', username: '...', credential: '...' },
// The old free Open Relay is listed too. As of Oct 2026 its address no longer
// answers, so it does nothing unless Metered brings it back.
const TURN = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    ...TURN,
  ],
};
export const HAS_RELAY = TURN.length > 0;

// Opens a peer with the given id (or a random one). Rejects with the PeerJS
// error type, e.g. 'unavailable-id' when someone already holds that id.
export function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { config: ICE, debug: 1 }) : new Peer({ config: ICE, debug: 1 });
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; peer.destroy(); reject(new Error('timeout')); } }, 12000);
    peer.on('open', () => { if (!done) { done = true; clearTimeout(timer); resolve(peer); } });
    // Stay findable: if the line to the PeerJS server drops (a Wi-Fi blip, a
    // sleeping laptop, a background tab), reconnect so the room code keeps
    // working. Games already running don't need it.
    peer.on('disconnected', () => {
      setTimeout(() => { if (done && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
    });
    peer.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      reject(Object.assign(new Error(err.type || err.message), { type: err.type }));
    });
  });
}

// A second channel on the same connection for positions, sent like UDP:
// unordered and never resent. On the main (reliable, ordered) channel one lost
// packet holds up everything behind it until it's resent, which is what made
// other players freeze for a moment on patchy Wi-Fi. Both sides create it
// with the same id, so it needs no extra handshake.
const FAST = { negotiated: true, id: 42, ordered: false, maxRetransmits: 0 };
const FAST_BACKLOG = 64 * 1024;      // skip an update rather than queue behind a slow link
const RELIABLE_BACKLOG = 256 * 1024;
const JSON_LIMIT = 16000;            // PeerJS refuses bigger JSON messages

// A message pipe to one other player (JSON messages).
export class Link {
  constructor(conn) {
    this.conn = conn;
    this.id = conn.peer;
    this.handlers = [];
    this.closeHandlers = [];
    this.ping = null;      // round trip in ms, from the browser's connection stats
    this.relay = false;    // true when the traffic goes through the TURN relay
    this.closeReason = '';  // why the link went down, for the "left the game" message
    conn.on('data', (d) => this.deliver(d));
    conn.on('close', () => this.closed());
    conn.on('error', (err) => { this.closeReason ||= `error: ${err?.type || err?.message || 'unknown'}`; this.closed(); });
    // A player whose tab crashed or lost the network never says goodbye: the
    // browser only notices the connection has gone quiet. Treat 8 seconds of
    // that as gone, instead of keeping a ghost player around for ~30.
    const pc = conn.peerConnection;
    pc?.addEventListener('iceconnectionstatechange', () => {
      const st = pc.iceConnectionState;
      clearTimeout(this.dropTimer);
      const drop = () => { this.closeReason ||= 'the network connection dropped'; this.close(); };
      if (st === 'failed') drop();
      else if (st === 'disconnected') this.dropTimer = setTimeout(drop, 8000);
    });
    this.fast = null;
    this.fastOk = false;
    if (conn.open) this.openFast();
    else conn.on('open', () => this.openFast());
    this.statsTimer = setInterval(() => this.readStats(), 2000);
    this.readStats();
  }

  deliver(d) { for (const h of this.handlers) h(d); }

  // The fast channel is only trusted once something arrives on it, so an
  // older copy of the game on the other end still gets everything.
  openFast() {
    if (this.fast || this.isClosed) return;
    try {
      const ch = this.conn.peerConnection?.createDataChannel('fast', FAST);
      if (!ch) return;
      ch.onopen = () => this.sendRaw(ch, '{"t":"fp"}');
      ch.onmessage = (e) => {
        this.fastOk = true;
        let d;
        try { d = JSON.parse(e.data); } catch { return; }
        if (d && d.t !== 'fp') this.deliver(d);
      };
      this.fast = ch;
    } catch { this.fast = null; }
  }

  sendRaw(ch, text) { try { ch.send(text); } catch { /* channel closing */ } }

  // For positions and snapshots: a newer one always follows, so it's fine to
  // drop one when the link is backed up.
  sendFast(msg) {
    if (this.isClosed) return;
    const ch = this.fast;
    if (ch?.readyState === 'open') {
      if (ch.bufferedAmount > FAST_BACKLOG) return;
      if (this.fastOk) { this.sendRaw(ch, JSON.stringify(msg)); return; }
      this.sendRaw(ch, '{"t":"fp"}');   // let the other side know we have it
    }
    if ((this.conn.dataChannel?.bufferedAmount ?? 0) > RELIABLE_BACKLOG) return;
    const text = JSON.stringify(msg);
    if (text.length < JSON_LIMIT) this.send(msg);
  }

  // Ping and route of the connection actually in use.
  async readStats() {
    const pc = this.conn.peerConnection;
    if (!pc?.getStats || this.isClosed) return;
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return;
      if (pair.currentRoundTripTime != null) this.ping = Math.round(pair.currentRoundTripTime * 1000);
      const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
      this.relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    } catch { /* stats unavailable */ }
  }
  closed() {
    if (this.isClosed) return;
    this.isClosed = true;
    clearInterval(this.statsTimer);
    clearTimeout(this.dropTimer);
    for (const h of this.closeHandlers) h();
  }
  onData(h) { this.handlers.push(h); }
  onClose(h) { this.closeHandlers.push(h); }
  send(msg) {
    if (this.isClosed || !this.conn.open) return;
    try { this.conn.send(msg); } catch { /* channel closing */ }
  }
  close() { try { this.conn.close(); } catch { /* already gone */ } this.closed(); }
}

const ROUTE = { host: 'local network', srflx: 'internet address', prflx: 'internet address', relay: 'relay' };

// Connect to a peer id; resolves with a Link once the channel is open. On
// failure the error carries .info: how far the connection got.
export function connect(peer, id, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const conn = peer.connect(id, { reliable: true, serialization: 'json' });
    const pc = conn.peerConnection;
    const info = { steps: [], mine: new Set(), theirs: new Set(), answered: false };
    pc?.addEventListener('icecandidate', (e) => { if (e.candidate?.type) info.mine.add(ROUTE[e.candidate.type] ?? e.candidate.type); });
    pc?.addEventListener('iceconnectionstatechange', () => info.steps.push(pc.iceConnectionState));
    let done = false;
    const fail = async (why) => {
      if (done) return;
      done = true;
      peer.off('error', onErr);
      info.answered = !!pc?.remoteDescription;
      try {
        (await pc.getStats()).forEach((r) => { if (r.type === 'remote-candidate') info.theirs.add(ROUTE[r.candidateType] ?? r.candidateType); });
      } catch { /* no stats */ }
      try { conn.close(); } catch { /* ignore */ }
      reject(Object.assign(new Error(why), { info }));
    };
    const onErr = (err) => { if (err.type === 'peer-unavailable' && String(err.message).includes(id)) fail('unavailable'); };
    peer.on('error', onErr);
    setTimeout(() => fail('timeout'), timeout);
    conn.on('open', () => {
      if (done) return;
      done = true;
      peer.off('error', onErr);
      resolve(new Link(conn));
    });
  });
}

// Browsers throttle timers in background tabs; a worker's timer keeps
// ticking, so the host can keep simulating while its tab is hidden.
export function backgroundTicker(ms, fn) {
  const src = `setInterval(() => postMessage(0), ${ms});`;
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = fn;
  return () => worker.terminate();
}
