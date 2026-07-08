import { Game, GamePhase } from './game/Game';
import { formatTime } from './game/HUD';

function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function setActive(id: string, on: boolean) {
  document.getElementById(id)?.classList.toggle('active', on);
}

function hideAllOverlays() {
  [
    'title-screen',
    'briefing-screen',
    'controls-overlay',
    'pause-screen',
    'complete-screen',
    'crash-screen',
  ].forEach((id) => setActive(id, false));
}

function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const game = new Game(canvas);

  const bestEl = document.getElementById('best-time-display');
  const refreshBest = () => {
    const b = game.loadBest();
    if (bestEl) bestEl.textContent = b !== null ? `BEST TIME  ${formatTime(b)}` : '';
  };
  refreshBest();

  const helpBtn = document.getElementById('btn-help');
  const touch = document.getElementById('touch-controls');

  const applyPhaseUI = (phase: GamePhase) => {
    hideAllOverlays();
    helpBtn?.classList.toggle('hidden', phase === 'title' || phase === 'briefing');

    if (isTouchDevice() && phase === 'playing') {
      touch?.classList.remove('hidden');
    } else {
      touch?.classList.add('hidden');
    }

    switch (phase) {
      case 'title':
        setActive('title-screen', true);
        break;
      case 'briefing':
        setActive('briefing-screen', true);
        break;
      case 'paused':
        setActive('pause-screen', true);
        break;
      case 'complete':
        setActive('complete-screen', true);
        refreshBest();
        break;
      case 'crash':
        setActive('crash-screen', true);
        break;
      case 'playing':
        break;
    }
  };

  game.onPhaseChange = applyPhaseUI;
  applyPhaseUI('title');

  document.getElementById('btn-enter')?.addEventListener('click', () => {
    hideAllOverlays();
    game.enterFlight();
  });
  document.getElementById('btn-briefing')?.addEventListener('click', () => {
    game.phase = 'briefing';
    applyPhaseUI('briefing');
  });
  document.getElementById('btn-brief-fly')?.addEventListener('click', () => {
    hideAllOverlays();
    game.enterFlight();
  });
  document.getElementById('btn-brief-back')?.addEventListener('click', () => {
    game.showTitle();
    applyPhaseUI('title');
  });

  document.getElementById('btn-resume')?.addEventListener('click', () => {
    hideAllOverlays();
    game.resume();
  });
  document.getElementById('btn-pause-controls')?.addEventListener('click', () => {
    setActive('pause-screen', false);
    setActive('controls-overlay', true);
  });
  document.getElementById('btn-pause-reset')?.addEventListener('click', () => {
    hideAllOverlays();
    game.enterFlight();
  });
  document.getElementById('btn-pause-title')?.addEventListener('click', () => {
    game.showTitle();
    applyPhaseUI('title');
  });

  document.getElementById('btn-controls-close')?.addEventListener('click', () => {
    setActive('controls-overlay', false);
    if (game.phase === 'paused') setActive('pause-screen', true);
    else if (game.phase === 'playing') {
      /* stay in flight */
    } else if (game.phase === 'title') setActive('title-screen', true);
  });

  document.getElementById('btn-help')?.addEventListener('click', () => {
    if (game.phase === 'playing') game.pause();
    setActive('pause-screen', false);
    setActive('controls-overlay', true);
  });

  document.getElementById('btn-complete-again')?.addEventListener('click', () => {
    hideAllOverlays();
    game.enterFlight();
  });
  document.getElementById('btn-complete-title')?.addEventListener('click', () => {
    game.showTitle();
    applyPhaseUI('title');
  });
  document.getElementById('btn-crash-reset')?.addEventListener('click', () => {
    hideAllOverlays();
    game.enterFlight();
  });
  document.getElementById('btn-crash-title')?.addEventListener('click', () => {
    game.showTitle();
    applyPhaseUI('title');
  });

  document.getElementById('touch-pause')?.addEventListener('click', () => {
    if (game.phase === 'playing') {
      game.pause();
      applyPhaseUI('paused');
    }
  });

  // Allow completing mission from pad without being stuck — also add soft complete button via landing
  // If all rings done, show hint; finish when on pad (handled in Game)

  game.start();
}

main();
