const start = () => {
  if (!window.TokenBoard) return setTimeout(start, 50);
  window.__board = window.TokenBoard.mount(document.getElementById('board'), {
    onReady: () => console.log('BOARD_READY'),
  });
};
start();
