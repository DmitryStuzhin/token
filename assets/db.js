/* ═══════════════════════════════════════════════════════════════════
   ЕДИНСТВЕННЫЙ ИСТОЧНИК ДАННЫХ ПРОТОТИПА

   Ни одна цифра на экранах не написана в разметке руками — всё
   считается из этих таблиц в core.js. Чтобы подключить настоящие
   данные, замените тело DB.load() на запрос к API. Структура таблиц
   повторяет доменную модель (docs/domain-model.excalidraw).

   Правки пользователя (ответы, время, статусы) складываются в
   localStorage поверх сида, поэтому прототип «живой».
   ═══════════════════════════════════════════════════════════════════ */
window.DB = (function () {
  const LS_KEY = 'arcs.state.v1';

  /* ── справочники ─────────────────────────────────────────────── */
  const subjects = [{ id: 'inf', name: 'Информатика', slug: 'inf' }];

  const topics = [
    { id: 't-num',  subjectId: 'inf', name: 'Системы счисления' },
    { id: 't-log',  subjectId: 'inf', name: 'Логика и таблицы истинности' },
    { id: 't-rec',  subjectId: 'inf', name: 'Рекурсия' },
    { id: 't-dp',   subjectId: 'inf', name: 'Динамическое программирование' },
    { id: 't-graph',subjectId: 'inf', name: 'Графы' },
    { id: 't-str',  subjectId: 'inf', name: 'Обработка строк' },
    { id: 't-sort', subjectId: 'inf', name: 'Сортировка и поиск' },
  ];

  /* Номер задания ЕГЭ → тема. Используется при импорте банка задач. */
  const egeTopic = {
    1:'t-log', 2:'t-log', 3:'t-str', 4:'t-num', 5:'t-num', 6:'t-rec', 7:'t-num',
    8:'t-str', 9:'t-str', 10:'t-str', 11:'t-num', 12:'t-str', 13:'t-graph',
    14:'t-num', 15:'t-log', 16:'t-rec', 17:'t-str', 18:'t-dp', 19:'t-dp',
    20:'t-dp', 21:'t-dp', 22:'t-graph', 23:'t-graph', 24:'t-str', 25:'t-num',
    26:'t-sort', 27:'t-sort',
  };

  /* ── люди ────────────────────────────────────────────────────── */
  const users = [
    { id:'u-anna',  role:'student', name:'Анна Ковалёва',   email:'anna.kov@mail.ru',   phone:'+7 999 123-45-67', tz:'Europe/Moscow' },
    { id:'u-dm',    role:'tutor',   name:'Дмитрий Соколов', email:'dm@arcs.studio',     phone:'+7 999 000-11-22', tz:'Europe/Moscow' },
    { id:'u-elena', role:'parent',  name:'Елена Ковалёва',  email:'e.kovaleva@mail.ru', phone:'+7 999 765-43-21', tz:'Europe/Moscow' },
    { id:'u-admin', role:'admin',   name:'Администратор',   email:'admin@arcs.studio',  phone:'',                 tz:'Europe/Moscow' },
    { id:'u-petr',  role:'student', name:'Пётр Волков',     email:'p.volkov@mail.ru',   phone:'+7 999 222-33-44', tz:'Europe/Moscow' },
    { id:'u-mila',  role:'student', name:'Мила Орлова',     email:'m.orlova@mail.ru',   phone:'+7 999 555-66-77', tz:'Europe/Moscow' },
  ];

  const studentProfiles = [
    { id:'s-anna', userId:'u-anna', grade:11, school:'Лицей №1533', startedAt:'2025-03-04' },
    { id:'s-petr', userId:'u-petr', grade:11, school:'Школа №57',    startedAt:'2025-09-15' },
    { id:'s-mila', userId:'u-mila', grade:10, school:'Гимназия №4',  startedAt:'2026-02-10' },
  ];

  const tutorProfiles = [
    { id:'tp-dm', userId:'u-dm', subjects:['inf'], yearsExp:4, rate:3000, meetingUrl:'https://telemost.yandex.ru/j/arcs-dm' },
  ];

  const guardians = [
    { id:'g-1', parentUserId:'u-elena', studentId:'s-anna', relation:'мама', status:'confirmed', isPayer:true },
  ];

  const enrollments = [
    { id:'e-anna', studentId:'s-anna', tutorId:'tp-dm', subjectId:'inf', status:'active', startedAt:'2025-03-04' },
    { id:'e-petr', studentId:'s-petr', tutorId:'tp-dm', subjectId:'inf', status:'active', startedAt:'2025-09-15' },
    { id:'e-mila', studentId:'s-mila', tutorId:'tp-dm', subjectId:'inf', status:'paused', startedAt:'2026-02-10' },
  ];

  const goals = [
    { studentId:'s-anna', targetScore:85, examDate:'2027-06-01', subjectId:'inf' },
    { studentId:'s-petr', targetScore:70, examDate:'2027-06-01', subjectId:'inf' },
    { studentId:'s-mila', targetScore:80, examDate:'2028-06-01', subjectId:'inf' },
  ];

  /* Платежи не реализованы: это только состояние абонемента для показа. */
  const subscriptions = [
    { id:'sub-anna', studentId:'s-anna', payerUserId:'u-elena', plan:'8 занятий', lessonsLeft:4, lessonsTotal:8, price:6000, nextChargeAt:'2026-08-15', status:'active' },
    { id:'sub-petr', studentId:'s-petr', payerUserId:'u-petr',  plan:'4 занятия', lessonsLeft:1, lessonsTotal:4, price:3200, nextChargeAt:'2026-08-11', status:'active' },
    { id:'sub-mila', studentId:'s-mila', payerUserId:'u-mila',  plan:'4 занятия', lessonsLeft:0, lessonsTotal:4, price:3200, nextChargeAt:null,         status:'paused' },
  ];

  const notificationPrefs = [
    { userId:'u-anna',  channel:'telegram', enabled:true,  handle:'@anna_kov' },
    { userId:'u-anna',  channel:'email',    enabled:false, handle:'anna.kov@mail.ru' },
    { userId:'u-anna',  channel:'lesson_reminder', enabled:true,  minutesBefore:60 },
    { userId:'u-anna',  channel:'hw_deadline',     enabled:true,  minutesBefore:1440 },
    { userId:'u-elena', channel:'telegram', enabled:true,  handle:'@e_kovaleva' },
    { userId:'u-elena', channel:'weekly_digest',   enabled:true },
    { userId:'u-elena', channel:'missed_lesson',   enabled:true },
    { userId:'u-elena', channel:'hw_overdue',      enabled:true },
  ];

  /* ── банк задач ──────────────────────────────────────────────────
     Сюда складывается результат импорта. Парсер не реализован; ниже
     ровно та форма записи, которую он должен отдавать. Всё, что видит
     ученик, берётся отсюда — своих формулировок в страницах нет.
     ──────────────────────────────────────────────────────────────── */
  const taskShape = {
    id:'строка, уникальный',
    egeNumber:'число 1..27',
    topicId:'ссылка на topics[].id (по egeTopic, если парсер не знает)',
    title:'короткий заголовок для списка',
    statement:'условие, простой текст или markdown',
    answer:'эталонный ответ строкой',
    answerType:'number | string | set',
    compare:'exact | ci (без регистра) | set (множество через пробел/запятую)',
    autoCheck:'true | false — false для №27 и всего, где нужен сам код',
    difficulty:'1..3',
    source:'откуда импортировано',
  };

  const tasks = [
    { id:'q-5-1',  egeNumber:5,  topicId:'t-num',  title:'Автомат и двоичная запись', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'Автомат получает на вход четырёхзначное число. По нему строится новое число: складываются первая и вторая цифры, затем вторая и третья, затем третья и четвёртая. Полученные суммы записываются подряд в порядке убывания. Укажите наименьшее число, при обработке которого автомат выдаёт 141312.', answer:'2839' },
    { id:'q-5-2',  egeNumber:5,  topicId:'t-num',  title:'Наименьшее число для автомата', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'На вход подаётся натуральное число N. Алгоритм строит новое число R: пока N > 0, к R приписывается остаток от деления N на 3, N уменьшается втрое. Найдите наименьшее N > 100, для которого R содержит ровно четыре цифры.', answer:'108' },
    { id:'q-17-1', egeNumber:17, topicId:'t-str',  title:'Обработка последовательности', autoCheck:true, answerType:'set', compare:'set', difficulty:3, source:'seed',
      statement:'В файле записана последовательность целых чисел. Найдите количество пар элементов, сумма которых кратна минимальному элементу последовательности, и максимальную из таких сумм. В ответе укажите два числа через пробел.', answer:'128 51872' },
    { id:'q-17-2', egeNumber:17, topicId:'t-str',  title:'Пары с заданным свойством', autoCheck:true, answerType:'set', compare:'set', difficulty:3, source:'seed',
      statement:'Дана последовательность натуральных чисел. Найдите количество пар соседних элементов, произведение которых оканчивается на 4, и максимальное такое произведение. В ответе укажите два числа через пробел.', answer:'44 9744' },
    { id:'q-16-1', egeNumber:16, topicId:'t-rec',  title:'Рекурсивная функция F(n)', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'Функция F(n) задана так: F(n) = n при n ≤ 3; F(n) = F(n−1) + 2·F(n−2) + 3·F(n−3) при n > 3. Чему равно значение F(12)?', answer:'11466' },
    { id:'q-16-2', egeNumber:16, topicId:'t-rec',  title:'Сумма цифр значения F', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'F(n) = 1 при n = 1; F(n) = n + F(n−1) при чётном n; F(n) = 2·F(n−1) при нечётном n > 1. Найдите сумму цифр числа F(15).', answer:'19' },
    { id:'q-19-1', egeNumber:19, topicId:'t-dp',   title:'Камни: выигрышная позиция', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'В куче S камней. Игроки по очереди берут 1 камень или увеличивают кучу вдвое. Выигрывает тот, после чьего хода в куче не менее 60 камней. Найдите минимальное S, при котором Петя выигрывает первым ходом.', answer:'30' },
    { id:'q-22-1', egeNumber:22, topicId:'t-graph',title:'Кратчайший путь по таблице', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'В таблице задана схема дорог между городами. Определите длину кратчайшего пути из города A в город K, двигаясь только по указанным дорогам.', answer:'17' },
    { id:'q-23-1', egeNumber:23, topicId:'t-graph',title:'Количество программ исполнителя', autoCheck:true, answerType:'number', compare:'exact', difficulty:3, source:'seed',
      statement:'Исполнитель умеет прибавлять 1 и умножать на 2. Сколько существует программ, переводящих число 2 в число 28 и не содержащих число 17?', answer:'104' },
    { id:'q-14-1', egeNumber:14, topicId:'t-num',  title:'Значение выражения в системе счисления', autoCheck:true, answerType:'number', compare:'exact', difficulty:1, source:'seed',
      statement:'Найдите наименьшее основание системы счисления, в которой запись числа 250 оканчивается на две одинаковые цифры.', answer:'7' },
    { id:'q-2-1',  egeNumber:2,  topicId:'t-log',  title:'Таблица истинности', autoCheck:true, answerType:'string', compare:'ci', difficulty:1, source:'seed',
      statement:'Логическая функция F задана выражением ¬x ∧ (y ∨ ¬z). Определите порядок столбцов таблицы истинности. В ответе запишите буквы без пробелов.', answer:'zyx' },
    { id:'q-27-1', egeNumber:27, topicId:'t-sort', title:'Программа обработки файла', autoCheck:false, answerType:'string', compare:'exact', difficulty:3, source:'seed',
      statement:'Дан файл из N пар чисел. Требуется написать программу, которая находит максимальную сумму пары, кратную 26. Приложите код программы — задание проверяет репетитор.', answer:'' },
  ];

  /* ── занятия ─────────────────────────────────────────────────── */
  const d = (offsetDays, hh, mm) => {
    const x = new Date();
    x.setDate(x.getDate() + offsetDays);
    x.setHours(hh, mm || 0, 0, 0);
    return x.toISOString();
  };

  const lessons = [
    { id:'l-1', enrollmentId:'e-anna', startsAt:d(0, 16), durationMin:90, status:'planned',
      links:[
        { type:'call',     label:'Яндекс Телемост', url:'https://telemost.yandex.ru/j/arcs-dm' },
        { type:'board',    label:'Доска Excalidraw', url:'https://excalidraw.com/#room=arcs-anna' },
        { type:'material', label:'Конспект: динамика на отрезках', url:'#' },
      ],
      taskIds:['q-17-1','q-19-1','q-16-1'] },
    { id:'l-2', enrollmentId:'e-anna', startsAt:d(-2, 16), durationMin:90, status:'done',
      links:[{ type:'call', label:'Яндекс Телемост', url:'https://telemost.yandex.ru/j/arcs-dm' }],
      taskIds:['q-16-2','q-5-1'],
      note:{ visibility:'parent', topics:['t-rec'], text:'Разобрали рекурсию, база даётся тяжело — дал дополнительные задачи.' } },
    { id:'l-3', enrollmentId:'e-anna', startsAt:d(-4, 16), durationMin:90, status:'done',
      links:[{ type:'call', label:'Яндекс Телемост', url:'https://telemost.yandex.ru/j/arcs-dm' }],
      taskIds:['q-14-1'],
      note:{ visibility:'student', topics:['t-num'], text:'Системы счисления на автомате. Молодец.' } },
    { id:'l-4', enrollmentId:'e-anna', startsAt:d(-7, 16), durationMin:90, status:'moved',  links:[], taskIds:[] },
    { id:'l-5', enrollmentId:'e-anna', startsAt:d(-9, 16), durationMin:90, status:'missed', links:[], taskIds:[] },
    { id:'l-6', enrollmentId:'e-anna', startsAt:d(3, 16),  durationMin:90, status:'planned',
      links:[{ type:'call', label:'Яндекс Телемост', url:'https://telemost.yandex.ru/j/arcs-dm' }], taskIds:[] },
    { id:'l-7', enrollmentId:'e-petr', startsAt:d(0, 18),  durationMin:60, status:'planned',
      links:[{ type:'call', label:'Zoom', url:'https://zoom.us/j/000' }], taskIds:['q-2-1'] },
    { id:'l-8', enrollmentId:'e-petr', startsAt:d(-3, 18), durationMin:60, status:'done', links:[], taskIds:['q-14-1'] },
  ].concat(lessonHistory());

  /* еженедельные занятия за прошедшие 3 месяца — база для посещаемости и часов */
  function lessonHistory() {
    const out = [];
    for (let w = 2; w <= 13; w++) {
      out.push({
        id: 'l-h' + w, enrollmentId: 'e-anna',
        startsAt: d(-7 * w, 16), durationMin: 90,
        status: w === 6 ? 'moved' : 'done',
        links: [], taskIds: [],
      });
    }
    return out;
  }

  /* ── домашние задания ────────────────────────────────────────── */
  const assignments = [
    { id:'a-1', enrollmentId:'e-anna', lessonId:'l-3', title:'Д/З №3 — обработка последовательностей', dueAt:d(-2, 20), taskIds:['q-17-2','q-5-2'] },
    { id:'a-2', enrollmentId:'e-anna', lessonId:'l-2', title:'Д/З №4 — динамика и рекурсия',           dueAt:d(2, 20),  taskIds:['q-19-1','q-16-2'] },
    { id:'a-3', enrollmentId:'e-anna', lessonId:'l-2', title:'Повторить: рекурсия, базовый случай',    dueAt:d(3, 20),  taskIds:['q-16-1'] },
    { id:'a-4', enrollmentId:'e-anna', lessonId:'l-3', title:'Пробный вариант — часть 2',              dueAt:d(-1, 20), taskIds:['q-27-1'] },
    { id:'a-5', enrollmentId:'e-petr', lessonId:'l-8', title:'Д/З — системы счисления',                dueAt:d(1, 20),  taskIds:['q-14-1'] },
  ];

  /* ── пробники ────────────────────────────────────────────────────
     Храним первичный балл (0..29) — тестовый считается по таблице
     перевода, как на настоящем экзамене.
     ──────────────────────────────────────────────────────────────── */
  const EGE_SCALE = [0,7,14,20,27,34,40,43,46,48,51,54,56,59,62,64,67,70,72,75,
                     78,80,83,85,88,90,93,95,97,100];

  /* максимум первичных баллов по номеру задания */
  const EGE_MAX = { 26:2, 27:2 };
  const egeMax = n => EGE_MAX[n] || 1;
  /* порядок, в котором ученик обычно набирает баллы — от простого к сложному */
  const EGE_ORDER = [1,2,4,5,3,7,11,14,6,15,8,9,10,12,13,16,18,19,20,21,22,24,25,17,23,26,27];

  const mockExams = [
    { id:'m-1', studentId:'s-anna', variant:'Вариант 1', date:d(-130,12), primary:11, items:mockItems(11) },
    { id:'m-2', studentId:'s-anna', variant:'Вариант 2', date:d(-100,12), primary:12, items:mockItems(12) },
    { id:'m-3', studentId:'s-anna', variant:'Вариант 3', date:d(-72,12),  primary:14, items:mockItems(14) },
    { id:'m-4', studentId:'s-anna', variant:'Вариант 4', date:d(-45,12),  primary:15, items:mockItems(15) },
    { id:'m-5', studentId:'s-anna', variant:'Вариант 5', date:d(-18,12),  primary:17, items:mockItems(17) },
    { id:'m-6', studentId:'s-anna', variant:'Вариант 6', date:d(-4,12),   primary:18, items:mockItems(18) },
  ];

  function mockItems(primary) {
    let left = primary;
    const got = {};
    EGE_ORDER.forEach(n => {
      const take = Math.max(0, Math.min(egeMax(n), left));
      got[n] = take; left -= take;
    });
    return EGE_ORDER.slice().sort((a, b) => a - b)
      .map(n => ({ egeNumber: n, got: got[n], max: egeMax(n) }));
  }

  /* ── попытки решения (TaskAttempt) ───────────────────────────────
     Единая сущность и для занятия, и для д/з, и для пробника.
     Ниже — детерминированный сид за последние ~90 дней: он один
     кормит хитмап, серию, проценты по темам и сводку по номерам.
     ──────────────────────────────────────────────────────────────── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedAttempts() {
    const rnd = mulberry32(20260807);
    const out = [];
    const pool = tasks.filter(t => t.autoCheck);
    /* вероятность верного ответа растёт со временем — отсюда положительная дельта тем */
    for (let back = 90; back >= 1; back--) {
      const dt = new Date(); dt.setDate(dt.getDate() - back); dt.setHours(19, 0, 0, 0);
      const dow = dt.getDay();
      let n = rnd() < (dow === 0 || dow === 6 ? .45 : .78) ? 1 + Math.floor(rnd() * 4) : 0;
      if (back <= 2) n = Math.max(n, 2);           /* последние дни точно активны — серия */
      for (let i = 0; i < n; i++) {
        const task = pool[Math.floor(rnd() * pool.length)];
        const progress = (90 - back) / 90;                    /* 0 → 1 */
        const base = { 1:.9, 2:.75, 3:.55 }[task.difficulty] || .7;
        const p = Math.min(.95, base * (.72 + .45 * progress));
        const correct = rnd() < p;
        const secs = Math.round((160 + rnd() * 900) * (task.difficulty / 2));
        const at = new Date(dt); at.setMinutes(at.getMinutes() + i * 17);
        out.push({
          id: 'at-seed-' + back + '-' + i,
          taskId: task.id, studentId: 's-anna',
          context: rnd() < .35 ? 'lesson' : 'homework',
          lessonId: null, assignmentId: null,
          code: '', answer: correct ? task.answer : 'x',
          tries: correct ? (rnd() < .6 ? 1 : 2) : 2,
          isCorrect: correct, firstTryCorrect: correct && rnd() < .65,
          activeSeconds: secs, status: 'checked',
          startedAt: at.toISOString(), submittedAt: at.toISOString(),
        });
      }
    }
    return out;
  }

  /* попытки, привязанные к конкретным д/з и занятиям — их видно на экранах */
  function boundAttempts() {
    const mk = (id, taskId, over) => Object.assign({
      id, taskId, studentId:'s-anna', context:'homework', lessonId:null, assignmentId:null,
      code:'', answer:'', tries:0, isCorrect:null, firstTryCorrect:null,
      activeSeconds:0, status:'issued', startedAt:null, submittedAt:null,
    }, over);

    return [
      /* Д/З №3 — просрочено, одна задача решена */
      mk('at-a1-1','q-17-2',{ assignmentId:'a-1', answer:'44 9744', tries:1, isCorrect:true,  firstTryCorrect:true,  activeSeconds:1580, status:'checked',  startedAt:d(-3,19), submittedAt:d(-3,19) }),
      mk('at-a1-2','q-5-2', { assignmentId:'a-1', activeSeconds:420, status:'in_progress', startedAt:d(-3,20), code:'n = 100\nwhile True:\n    ' }),
      /* Д/З №4 — в работе */
      mk('at-a2-1','q-19-1',{ assignmentId:'a-2', answer:'30', tries:1, isCorrect:true, firstTryCorrect:true, activeSeconds:960, status:'checked', startedAt:d(-1,18), submittedAt:d(-1,18) }),
      mk('at-a2-2','q-16-2',{ assignmentId:'a-2', activeSeconds:0, status:'issued' }),
      /* Повторение — не начато */
      mk('at-a3-1','q-16-1',{ assignmentId:'a-3', status:'issued' }),
      /* Часть 2 — отправлено, ждёт ручной проверки */
      mk('at-a4-1','q-27-1',{ assignmentId:'a-4', status:'submitted', activeSeconds:2760, startedAt:d(-2,17), submittedAt:d(-1,15),
        code:'f = open("27-A.txt")\nn = int(f.readline())\nbest = 0\nfor line in f:\n    a, b = map(int, line.split())\n    s = a + b\n    if s % 26 == 0 and s > best:\n        best = s\nprint(best)' }),
      /* задачи ближайшего занятия — выданы, ещё не начаты */
      mk('at-l1-1','q-17-1',{ context:'lesson', lessonId:'l-1', assignmentId:null, status:'issued' }),
      mk('at-l1-2','q-19-1',{ context:'lesson', lessonId:'l-1', assignmentId:null, status:'issued' }),
      mk('at-l1-3','q-16-1',{ context:'lesson', lessonId:'l-1', assignmentId:null, status:'issued' }),
      /* Пётр — чтобы у репетитора было больше одного ученика */
      Object.assign(mk('at-p1','q-14-1',{ assignmentId:'a-5', status:'submitted', activeSeconds:640, startedAt:d(-1,17), submittedAt:d(-1,17), answer:'7', tries:1 }), { studentId:'s-petr' }),
    ];
  }

  /* ── сборка и хранение ───────────────────────────────────────── */
  function build() {
    return {
      generatedAt: new Date().toISOString(),
      subjects, topics, egeTopic, users, studentProfiles, tutorProfiles,
      guardians, enrollments, goals, subscriptions, notificationPrefs,
      taskShape, tasks, lessons, assignments, mockExams, EGE_SCALE, egeMax,
      attempts: boundAttempts().concat(seedAttempts()),
    };
  }

  let state = null;

  function load() {
    if (state) return state;
    const fresh = build();
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved && saved.attempts) {
        /* накатываем сохранённые правки попыток поверх свежего сида */
        const byId = new Map(saved.attempts.map(a => [a.id, a]));
        fresh.attempts = fresh.attempts.map(a => byId.has(a.id) ? Object.assign({}, a, byId.get(a.id)) : a);
        if (saved.prefs) fresh.notificationPrefs = saved.prefs;
        if (saved.importedTasks && saved.importedTasks.length) {
          const have = new Set(fresh.tasks.map(t => t.id));
          saved.importedTasks.forEach(t => { if (!have.has(t.id)) fresh.tasks.push(t); });
        }
        if (saved.lessonTasks) {
          fresh.lessons.forEach(l => {
            if (saved.lessonTasks[l.id]) l.taskIds = saved.lessonTasks[l.id];
          });
        }
      }
    } catch (e) { /* поехавший localStorage не должен ронять страницу */ }
    state = fresh;
    return state;
  }

  function save() {
    if (!state) return;
    const slim = state.attempts.map(a => ({
      id:a.id, answer:a.answer, tries:a.tries, isCorrect:a.isCorrect,
      firstTryCorrect:a.firstTryCorrect, activeSeconds:a.activeSeconds,
      status:a.status, startedAt:a.startedAt, submittedAt:a.submittedAt, code:a.code,
    }));
    const lessonTasks = {};
    state.lessons.forEach(l => { lessonTasks[l.id] = l.taskIds; });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        attempts: slim, prefs: state.notificationPrefs, lessonTasks,
        importedTasks: state.tasks.filter(t => t.source !== 'seed'),
      }));
    } catch (e) {}
  }

  function reset() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    state = null;
    location.reload();
  }

  return { load, save, reset, LS_KEY };
})();
