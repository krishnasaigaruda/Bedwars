// Waiting-lobby team picker (E in the lobby). Shows the room code, who is on
// which team, and a Start button for the host of a private room.
import { MODES, TEAMS } from '../config.js';

export class LobbyUI {
  constructor(root, { onPick, onStart, onClose }) {
    this.root = root;
    this.open = false;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-team]');
      if (t && !t.classList.contains('full')) { onPick(Number(t.dataset.team)); return; }
      if (e.target.closest('[data-start]')) { onStart(); return; }
      if (e.target.closest('[data-close]') || e.target === root) onClose();
    });
  }

  show(lobby, myId, canStart) {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render(lobby, myId, canStart);
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
  }

  render(lobby, myId, canStart) {
    if (!this.open || !lobby) return;
    const mode = MODES[lobby.mode] ?? MODES.solo;
    const me = lobby.players.find((p) => p.id === myId);
    const cards = TEAMS.slice(0, mode.teams).map((t, i) => {
      const members = lobby.players.filter((p) => p.team === i);
      const full = members.length >= mode.size && me?.team !== i;
      return `<button class="team-card ${me?.team === i ? 'mine' : ''} ${full ? 'full' : ''}" data-team="${i}">
        <span class="team-name"><i style="background:${t.css}"></i>${t.name}</span>
        <span class="team-members">${members.map((p) => p.name).join(', ') || `0/${mode.size}`}</span></button>`;
    }).join('');
    const auto = lobby.players.filter((p) => p.team < 0).map((p) => p.name).join(', ');
    this.root.innerHTML = `
      <div class="panel teams-panel">
        <button class="close-x" data-close>✕</button>
        <div class="panel-title">Pick a Team</div>
        <div class="teams-grid">${cards}</div>
        <button class="btn btn-wood" data-team="-1">Random team${auto ? ` · ${auto}` : ''}</button>
        <div class="teams-foot">
          ${lobby.code ? `<span class="room-code">ROOM ${lobby.code}</span>` : '<span></span>'}
          <span class="lobby-list">${lobby.players.length}/${mode.teams * mode.size} players · ${mode.label}</span>
          ${canStart ? '<button class="btn btn-green" data-start>Start game</button>' : ''}
        </div>
      </div>`;
  }
}
