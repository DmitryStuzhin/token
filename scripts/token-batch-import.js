/*
 * Однокнопочный пакетный импорт для страницы Token /bank.html.
 * Использование: вставить весь JSON в поле импорта, открыть консоль браузера,
 * вставить содержимое этого файла и нажать Enter.
 */
(async function tokenBatchImport() {
  const BATCH_SIZE = 10;
  const PAUSE_MS = 150;
  const input = document.getElementById('imp');
  const output = document.getElementById('imp-out');
  if (!input || !output) throw new Error('Откройте страницу «Банк задач» с формой импорта');
  if (!window.Api?.importTasks) throw new Error('На странице не найден API импорта Token');

  let tasks;
  try { tasks = JSON.parse(input.value.trim()); }
  catch (error) { throw new Error(`JSON не разобрался: ${error.message}`); }
  if (!Array.isArray(tasks) || !tasks.length) throw new Error('Ожидался непустой JSON-массив задач');

  const duplicateIds = tasks.map(task => String(task.id)).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`В файле повторяются ID: ${[...new Set(duplicateIds)].slice(0, 5).join(', ')}`);

  const existingIds = new Set((window.Core?.db?.tasks || []).map(task => String(task.id)));
  const pending = tasks.filter(task => !existingIds.has(String(task.id)));
  const skipped = tasks.length - pending.length;
  const batches = [];
  for (let index = 0; index < pending.length; index += BATCH_SIZE) {
    batches.push(pending.slice(index, index + BATCH_SIZE));
  }

  const render = (done, message, failed = false) => {
    const imported = Math.min(done * BATCH_SIZE, pending.length);
    const percent = batches.length ? Math.round(done / batches.length * 100) : 100;
    output.innerHTML = `<div class="verdict ${failed ? 'v-no' : done === batches.length ? 'v-ok' : 'v-wait'}">
      ${message}<br>Импортировано: ${imported} из ${pending.length}; пропущено существующих: ${skipped} (${percent}%).
    </div>`;
  };

  if (!batches.length) { render(0, 'Все задания уже присутствуют в банке.'); return; }
  render(0, `Подготовлено ${batches.length} пакетов. Начинаю импорт…`);

  for (let index = 0; index < batches.length; index++) {
    try {
      await Api.importTasks(batches[index]);
      render(index + 1, `Пакет ${index + 1} из ${batches.length} добавлен.`);
      if (index + 1 < batches.length) await new Promise(resolve => setTimeout(resolve, PAUSE_MS));
    } catch (error) {
      render(index, `Остановка на пакете ${index + 1}: ${error.message}. Обновите страницу и запустите загрузчик снова — уже добавленные ID будут пропущены.`, true);
      throw error;
    }
  }
  render(batches.length, 'Готово. Все пакеты успешно добавлены. Обновите страницу, чтобы увидеть задания.');
})();
