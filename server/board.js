/* ═══════════════════════════════════════════════════════════════════
   ДОСКА ЗАНЯТИЯ

   Сервер держит сцену занятия в памяти и раздаёт её участникам. Правки
   приходят поэлементно, а не сценой целиком: гонять весь холст на каждый
   штрих — это мегабайты в секунду на рисующей руке.

   Слияние идёт по правилу самого Excalidraw: у элемента есть version,
   и выигрывает бо́льшая. При равных версиях — бо́льший versionNonce.
   Это даёт одинаковый результат у всех участников независимо от порядка
   доставки, поэтому «последний записавший» не затирает чужую правку
   задним числом.
   ═══════════════════════════════════════════════════════════════════ */

const MAX_ELEMENTS = 5000;
const MAX_ELEMENTS_PER_MESSAGE = 400;
const MAX_POINTS_PER_ELEMENT = 4000;
const SAVE_DEBOUNCE_MS = 3000;

/** Побеждает бо́льшая версия; при равенстве — бо́льший nonce. */
function wins(incoming, current) {
  if (!current) return true;
  const a = Number(incoming.version) || 0;
  const b = Number(current.version) || 0;
  if (a !== b) return a > b;
  return (Number(incoming.versionNonce) || 0) > (Number(current.versionNonce) || 0);
}

/**
 * Элементы приходят из браузера, то есть от недоверенной стороны. Проверяем
 * форму и режем размер: холст занятия не должен превращаться в файловое
 * хранилище или в способ уронить процесс одной длинной кривой.
 */
function sanitize(element) {
  if (!element || typeof element !== 'object') return null;
  const id = String(element.id || '');
  const type = String(element.type || '');
  if (!id || id.length > 100 || !type || type.length > 40) return null;
  if (Array.isArray(element.points) && element.points.length > MAX_POINTS_PER_ELEMENT) return null;
  // Картинки лежат в отдельном хранилище файлов, инлайн data: не принимаем.
  if (typeof element.fileId === 'string' && element.fileId.length > 200) return null;
  return { ...element, id, type };
}

class LessonBoards {
  constructor(repository, logger) {
    this.repository = repository;
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.scenes = new Map();
    this.timers = new Map();
  }

  /** Сцена из памяти, при первом обращении — из базы. */
  async scene(lessonId) {
    if (this.scenes.has(lessonId)) return this.scenes.get(lessonId);
    let elements = [];
    try {
      elements = (await this.repository.loadBoard(lessonId)) || [];
    } catch (error) {
      this.logger.error('board_load_failed', { lessonId, error: error.message });
    }
    const map = new Map();
    for (const element of elements) {
      const clean = sanitize(element);
      if (clean) map.set(clean.id, clean);
    }
    this.scenes.set(lessonId, map);
    return map;
  }

  /**
   * Применяет правки и возвращает те, что действительно что-то изменили:
   * рассылать проигравшие в слиянии элементы значит гонять эхо по кругу.
   */
  async apply(lessonId, incoming) {
    if (!Array.isArray(incoming) || !incoming.length) return [];
    const map = await this.scene(lessonId);
    const accepted = [];
    for (const raw of incoming.slice(0, MAX_ELEMENTS_PER_MESSAGE)) {
      const element = sanitize(raw);
      if (!element) continue;
      if (!map.has(element.id) && map.size >= MAX_ELEMENTS) continue;
      if (!wins(element, map.get(element.id))) continue;
      map.set(element.id, element);
      accepted.push(element);
    }
    if (accepted.length) this.scheduleSave(lessonId);
    return accepted;
  }

  async elements(lessonId) {
    return [...(await this.scene(lessonId)).values()];
  }

  /**
   * Запись отложенная: во время рисования правки идут десятками в секунду,
   * и писать в базу на каждую — гарантированный тормоз на общем диске VPS.
   */
  scheduleSave(lessonId) {
    if (this.timers.has(lessonId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(lessonId);
      void this.save(lessonId);
    }, SAVE_DEBOUNCE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(lessonId, timer);
  }

  async save(lessonId) {
    const map = this.scenes.get(lessonId);
    if (!map) return;
    try {
      await this.repository.saveBoard(lessonId, [...map.values()]);
    } catch (error) {
      this.logger.error('board_save_failed', { lessonId, error: error.message });
    }
  }

  /** Комната опустела: дописываем и отпускаем память. */
  async release(lessonId) {
    const timer = this.timers.get(lessonId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(lessonId);
    }
    await this.save(lessonId);
    this.scenes.delete(lessonId);
  }
}

module.exports = { LessonBoards, wins, sanitize, MAX_ELEMENTS };
