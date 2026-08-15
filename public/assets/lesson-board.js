/* ═══════════════════════════════════════════════════════════════════
   ДОСКА ЗАНЯТИЯ — КЛИЕНТ

   Живёт вне #lesson-root: рабочая область занятия перерисовывается через
   innerHTML, и React-корень внутри неё умирал бы на каждой перерисовке.

   Правила синхронизации те же, что на сервере: наружу уходят только
   изменившиеся элементы, входящие принимаются по бо́льшей версии. Эхо
   собственных правок отбрасывается сравнением версий, поэтому цикла
   «отправил → получил → отправил» не возникает.
   ═══════════════════════════════════════════════════════════════════ */
window.LessonBoard = (function () {
  const SEND_INTERVAL_MS = 120;
  const POINTER_INTERVAL_MS = 90;
  const COLLABORATOR_TTL_MS = 15000;

  let board = null;
  let send = () => false;
  let known = new Map();
  let outbox = new Map();
  let sendTimer = null;
  let pointerAt = 0;
  const collaborators = new Map();

  const versionOf = element => Number(element && element.version) || 0;
  const nonceOf = element => Number(element && element.versionNonce) || 0;
  const newer = (incoming, current) =>
    !current ||
    versionOf(incoming) > versionOf(current) ||
    (versionOf(incoming) === versionOf(current) && nonceOf(incoming) > nonceOf(current));

  function flush() {
    sendTimer = null;
    if (!outbox.size) return;
    const elements = [...outbox.values()];
    outbox = new Map();
    send({ type: 'board_update', elements });
  }

  function queue(element) {
    outbox.set(element.id, element);
    if (!sendTimer) sendTimer = setTimeout(flush, SEND_INTERVAL_MS);
  }

  /**
   * Правки редактора. Отдельного «молчим, пока применяем чужое» не нужно:
   * применённый чужой элемент уже лежит в known с той же версией, поэтому
   * сравнение версий само отсекает эхо. Флаг-заглушка здесь была бы опасна —
   * она глотала бы штрихи, нарисованные ровно в момент прихода чужой правки.
   */
  function onChange(elements) {
    for (const element of elements) {
      const current = known.get(element.id);
      if (current && versionOf(current) === versionOf(element) && nonceOf(current) === nonceOf(element)) continue;
      known.set(element.id, element);
      queue(element);
    }
  }

  function onPointerUpdate(payload) {
    const now = Date.now();
    if (now - pointerAt < POINTER_INTERVAL_MS) return;
    pointerAt = now;
    send({
      type: 'board_pointer',
      pointer: payload && payload.pointer,
      button: payload && payload.button,
    });
  }

  /**
   * Слияние входящих правок в текущую сцену редактора.
   *
   * Базой берётся именно сцена редактора, а не то, что клиент успел разослать.
   * Если строить сцену из своего множества, всё нарисованное между отправками
   * стирается у автора на первой же чужой правке — ровно это и происходило.
   */
  function applyRemote(elements) {
    const incoming = elements.filter(element => newer(element, known.get(element.id)));
    if (!incoming.length) return;
    for (const element of incoming) known.set(element.id, element);
    if (!board) return;
    const scene = new Map(board.getElements().map(element => [element.id, element]));
    for (const element of incoming) {
      if (newer(element, scene.get(element.id))) scene.set(element.id, element);
    }
    board.updateScene({ elements: [...scene.values()] });
  }

  function refreshCollaborators() {
    const now = Date.now();
    for (const [id, value] of collaborators) {
      if (now - value.at > COLLABORATOR_TTL_MS) collaborators.delete(id);
    }
    if (!board) return;
    const map = new Map();
    for (const [id, value] of collaborators) {
      map.set(id, { username: value.name, pointer: value.pointer, button: value.button });
    }
    board.setCollaborators(map);
  }

  function onPointer(message) {
    collaborators.set(message.id, {
      name: message.name || (message.role === 'tutor' ? 'Репетитор' : 'Ученик'),
      pointer: message.pointer,
      button: message.button,
      at: Date.now(),
    });
    refreshCollaborators();
  }

  function onLeft(message) {
    if (collaborators.delete(message.id)) refreshCollaborators();
  }

  function handle(message) {
    if (!message) return;
    if (message.type === 'board_snapshot') {
      // Снимок не обнуляет known: свои несохранённые штрихи он затирать не должен.
      applyRemote(message.elements || []);
      board?.scrollToContent();
      return;
    }
    if (message.type === 'board_update') applyRemote(message.elements || []);
    if (message.type === 'board_pointer') onPointer(message);
    if (message.type === 'board_left') onLeft(message);
  }

  /**
   * Бандл редактора весит заметно больше остального фронтенда, поэтому
   * подгружается только когда доску действительно открыли.
   */
  let loading = null;
  function loadEditor() {
    if (window.TokenBoard) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = '/vendor/entry.js';
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () => reject(new Error('Не удалось загрузить доску')));
        document.head.append(script);
      });
    }
    return loading;
  }

  /**
   * Запрос снимка. Отдельно от open, потому что доска может открыться раньше,
   * чем поднимется сокет: тогда запрос уходит в никуда и сцена остаётся пустой.
   * Вызывается ещё и на каждом переподключении — после обрыва мы могли
   * пропустить чужие правки.
   */
  function sync() {
    return send({ type: 'board_sync' });
  }

  async function open(container, transport) {
    send = transport;
    await loadEditor();
    if (board) return board;
    board = window.TokenBoard.mount(container, { onChange, onPointerUpdate });
    sync();
    return board;
  }

  function isOpen() {
    return board !== null;
  }

  function close() {
    if (sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = null;
    }
    flush();
  }

  /** Сколько элементов сцены известно этому клиенту — для диагностики. */
  function count() {
    return known.size;
  }

  return { open, close, handle, loadEditor, count, sync, isOpen };
})();
