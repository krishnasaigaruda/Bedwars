// Thin wrapper around PeerJS. The free PeerJS cloud server is only used to
// find each other; game traffic then goes browser-to-browser over WebRTC.
import { Peer } from 'peerjs';

export const PREFIX = 'bwfun1';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Free public relay (Open Relay Project) for networks that block direct connections.
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

// Opens a peer with the given id (or a random one). Rejects with the PeerJS
// error type, e.g. 'unavailable-id' when someone already holds that id.
export function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { config: ICE, debug: 1 }) : new Peer({ config: ICE, debug: 1 });
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; peer.destroy(); reject(new Error('timeout')); } }, 12000);
    peer.on('open', () => { if (!done) { done = true; clearTimeout(timer); resolve(peer); } });
    peer.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      reject(Object.assign(new Error(err.type || err.message), { type: err.type }));
    });
  });
}

// A message pipe to one other player (JSON messages).
export class Link {
  constructor(conn) {
    this.conn = conn;
    this.id = conn.peer;
    this.handlers = [];
    this.closeHandlers = [];
    conn.on('data', (d) => { for (const h of this.handlers) h(d); });
    conn.on('close', () => this.closed());
    conn.on('error', () => this.closed());
  }
  closed() {
    if (this.isClosed) return;
    this.isClosed = true;
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

// Connect to a peer id; resolves with a Link once the channel is open.
export function connect(peer, id, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const conn = peer.connect(id, { reliable: true, serialization: 'json' });
    let done = false;
    const fail = (why) => {
      if (done) return;
      done = true;
      peer.off('error', onErr);
      try { conn.close(); } catch { /* ignore */ }
      reject(new Error(why));
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
