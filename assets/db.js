/* ═══════════════════════════════════════════════════════════════════
   ЕДИНСТВЕННЫЙ ИСТОЧНИК ДАННЫХ ПРОТОТИПА

   Ни одна цифра на экранах не написана в разметке руками — всё
   считается из этих таблиц в core.js. Чтобы подключить настоящие
   данные, замените тело DB.load() на запрос к API.

   Модель рассчитана на рост вширь:
     · предметы — данные, а не код. Номера заданий, максимумы и шкала
       перевода лежат в subject.exam, поэтому добавить математику или
       физику = добавить объект, не трогая ни одной страницы;
     · занятия и д/з адресуются либо привязке (индивидуально), либо
       группе — статистика в обоих случаях одна, через TaskAttempt;
     · привязка ученика к репетитору создаётся по ссылке-приглашению.
   ═══════════════════════════════════════════════════════════════════ */
window.DB = (function () {
  const LS_KEY = 'arcs.state.v2';

  /* ── шкалы перевода первичного балла в тестовый ──────────────── */
  const SCALE_INF = [0,7,14,20,27,34,40,43,46,48,51,54,56,59,62,64,67,70,72,75,
                     78,80,83,85,88,90,93,95,97,100];
  const SCALE_MATH = [0,6,11,17,22,27,34,40,46,52,58,64,66,68,70,72,74,76,78,80,
                      82,84,86,88,90,92,94,96,98,99,100,100,100];

  /* части экзамена: номер задания → максимум первичных баллов и тема */
  const partsInf = [
    [1,1,'t-log'],[2,1,'t-log'],[3,1,'t-str'],[4,1,'t-num'],[5,1,'t-num'],
    [6,1,'t-rec'],[7,1,'t-num'],[8,1,'t-str'],[9,1,'t-str'],[10,1,'t-str'],
    [11,1,'t-num'],[12,1,'t-str'],[13,1,'t-graph'],[14,1,'t-num'],[15,1,'t-log'],
    [16,1,'t-rec'],[17,1,'t-str'],[18,1,'t-dp'],[19,1,'t-dp'],[20,1,'t-dp'],
    [21,1,'t-dp'],[22,1,'t-graph'],[23,1,'t-graph'],[24,1,'t-str'],[25,1,'t-num'],
    [26,2,'t-sort'],[27,2,'t-sort'],
  ];
  const partsMath = [
    [1,1,'m-plan'],[2,1,'m-vect'],[3,1,'m-prob'],[4,1,'m-prob'],[5,1,'m-stereo'],
    [6,1,'m-func'],[7,1,'m-func'],[8,1,'m-func'],[9,1,'m-text'],[10,1,'m-text'],
    [11,1,'m-func'],[12,2,'m-trig'],[13,2,'m-stereo'],[14,2,'m-ineq'],
    [15,2,'m-text'],[16,3,'m-plan'],[17,3,'m-param'],[18,4,'m-theory'],
  ];

  const mkParts = rows => rows.map(([number, maxPoints, topicId]) => ({ number, maxPoints, topicId }));

  const subjects = [
    { id:'inf', name:'Информатика', short:'Инф', slug:'inf', color:'blue',
      exam:{ name:'ЕГЭ', scale:SCALE_INF, parts:mkParts(partsInf) } },
    { id:'math', name:'Математика (профиль)', short:'Матем', slug:'math', color:'violet',
      exam:{ name:'ЕГЭ', scale:SCALE_MATH, parts:mkParts(partsMath) } },
  ];

  const topics = [
    /* информатика */
    { id:'t-num',   subjectId:'inf', name:'Системы счисления' },
    { id:'t-log',   subjectId:'inf', name:'Логика и таблицы истинности' },
    { id:'t-rec',   subjectId:'inf', name:'Рекурсия' },
    { id:'t-dp',    subjectId:'inf', name:'Динамическое программирование' },
    { id:'t-graph', subjectId:'inf', name:'Графы' },
    { id:'t-str',   subjectId:'inf', name:'Обработка строк' },
    { id:'t-sort',  subjectId:'inf', name:'Сортировка и поиск' },
    /* математика */
    { id:'m-plan',   subjectId:'math', name:'Планиметрия' },
    { id:'m-stereo', subjectId:'math', name:'Стереометрия' },
    { id:'m-prob',   subjectId:'math', name:'Теория вероятностей' },
    { id:'m-func',   subjectId:'math', name:'Функции и производная' },
    { id:'m-text',   subjectId:'math', name:'Текстовые задачи' },
    { id:'m-trig',   subjectId:'math', name:'Тригонометрия' },
    { id:'m-ineq',   subjectId:'math', name:'Неравенства' },
    { id:'m-vect',   subjectId:'math', name:'Векторы' },
    { id:'m-param',  subjectId:'math', name:'Задачи с параметром' },
    { id:'m-theory', subjectId:'math', name:'Теория чисел' },
  ];

  /* ── люди ────────────────────────────────────────────────────── */
  const users = [
    { id:'u-anna',  role:'student', name:'Анна Ковалёва',   email:'anna.kov@mail.ru',   phone:'+7 999 123-45-67', tz:'Europe/Moscow' },
    { id:'u-dm',    role:'tutor',   name:'Дмитрий Соколов', email:'dm@arcs.studio',     phone:'+7 999 000-11-22', tz:'Europe/Moscow' },
    { id:'u-olga',  role:'tutor',   name:'Ольга Титова',    email:'olga@arcs.studio',   phone:'+7 999 010-20-30', tz:'Europe/Moscow' },
    { id:'u-elena', role:'parent',  name:'Елена Ковалёва',  email:'e.kovaleva@mail.ru', phone:'+7 999 765-43-21', tz:'Europe/Moscow' },
    { id:'u-admin', role:'admin',   name:'Администратор',   email:'admin@arcs.studio',  phone:'', tz:'Europe/Moscow' },
    { id:'u-petr',  role:'student', name:'Пётр Волков',     email:'p.volkov@mail.ru',   phone:'+7 999 222-33-44', tz:'Europe/Moscow' },
    { id:'u-mila',  role:'student', name:'Мила Орлова',     email:'m.orlova@mail.ru',   phone:'+7 999 555-66-77', tz:'Europe/Moscow' },
    { id:'u-kir',   role:'student', name:'Кирилл Дёмин',    email:'k.demin@mail.ru',    phone:'+7 999 111-00-99', tz:'Asia/Yekaterinburg' },
    { id:'u-sofia', role:'student', name:'София Нечаева',   email:'s.nechaeva@mail.ru', phone:'+7 999 444-55-66', tz:'Europe/Moscow' },
  ];

  const studentProfiles = [
    { id:'s-anna',  userId:'u-anna',  grade:11, school:'Лицей №1533', startedAt:'2025-03-04' },
    { id:'s-petr',  userId:'u-petr',  grade:11, school:'Школа №57',   startedAt:'2025-09-15' },
    { id:'s-mila',  userId:'u-mila',  grade:10, school:'Гимназия №4', startedAt:'2026-02-10' },
    { id:'s-kir',   userId:'u-kir',   grade:11, school:'Школа №12',   startedAt:'2026-03-01' },
    { id:'s-sofia', userId:'u-sofia', grade:11, school:'Лицей №2',    startedAt:'2026-03-01' },
  ];

  const tutorProfiles = [
    { id:'tp-dm',   userId:'u-dm',   subjects:['inf'],  yearsExp:4, rate:3000, meetingUrl:'https://telemost.yandex.ru/j/arcs-dm' },
    { id:'tp-olga', userId:'u-olga', subjects:['math'], yearsExp:7, rate:3500, meetingUrl:'https://telemost.yandex.ru/j/arcs-olga' },
  ];

  const guardians = [
    { id:'g-1', parentUserId:'u-elena', studentId:'s-anna', relation:'мама', status:'confirmed', isPayer:true },
  ];

  /* ── привязки: ученик ↔ репетитор ↔ предмет ──────────────────── */
  const enrollments = [
    { id:'e-anna-inf',  studentId:'s-anna',  tutorId:'tp-dm',   subjectId:'inf',  status:'active', startedAt:'2025-03-04', source:'invite' },
    { id:'e-anna-math', studentId:'s-anna',  tutorId:'tp-olga', subjectId:'math', status:'active', startedAt:'2026-05-20', source:'invite' },
    { id:'e-petr-inf',  studentId:'s-petr',  tutorId:'tp-dm',   subjectId:'inf',  status:'active', startedAt:'2025-09-15', source:'admin' },
    { id:'e-mila-inf',  studentId:'s-mila',  tutorId:'tp-dm',   subjectId:'inf',  status:'paused', startedAt:'2026-02-10', source:'admin' },
    { id:'e-kir-inf',   studentId:'s-kir',   tutorId:'tp-dm',   subjectId:'inf',  status:'active', startedAt:'2026-03-01', source:'invite' },
    { id:'e-sofia-inf', studentId:'s-sofia', tutorId:'tp-dm',   subjectId:'inf',  status:'active', startedAt:'2026-03-01', source:'invite' },
  ];

  /* ── группы ──────────────────────────────────────────────────── */
  const groups = [
    { id:'gr-inf-evening', tutorId:'tp-dm', subjectId:'inf',
      title:'ЕГЭ информатика · вечерняя', level:'продвинутая',
      schedule:'вт, чт · 19:00', capacity:8, status:'active', createdAt:'2026-03-01' },
    { id:'gr-inf-base', tutorId:'tp-dm', subjectId:'inf',
      title:'Информатика с нуля', level:'база',
      schedule:'сб · 12:00', capacity:10, status:'recruiting', createdAt:'2026-06-15' },
  ];

  const groupMembers = [
    { groupId:'gr-inf-evening', studentId:'s-petr',  joinedAt:'2026-03-02', status:'active' },
    { groupId:'gr-inf-evening', studentId:'s-kir',   joinedAt:'2026-03-05', status:'active' },
    { groupId:'gr-inf-evening', studentId:'s-sofia', joinedAt:'2026-03-05', status:'active' },
    { groupId:'gr-inf-evening', studentId:'s-mila',  joinedAt:'2026-04-01', status:'left'   },
  ];

  /* ── приглашения ─────────────────────────────────────────────────
     Ученик присоединяется по ссылке invite.html?code=… .
     Одна таблица закрывает и индивидуальную привязку, и группу,
     и доступ родителя — отличается только kind.
     ──────────────────────────────────────────────────────────────── */
  const invites = [
    { id:'inv-1', code:'DM-INF-7K2P', kind:'enrollment', tutorId:'tp-dm', subjectId:'inf',
      groupId:null, createdBy:'u-dm', createdAt:'2026-07-01', expiresAt:'2026-12-31',
      maxUses:null, usedCount:2, status:'active',
      note:'Индивидуальные занятия по информатике' },
    { id:'inv-2', code:'DM-GRP-4XQ9', kind:'group', tutorId:'tp-dm', subjectId:'inf',
      groupId:'gr-inf-evening', createdBy:'u-dm', createdAt:'2026-06-20', expiresAt:'2026-09-01',
      maxUses:8, usedCount:3, status:'active',
      note:'Набор в вечернюю группу' },
    { id:'inv-3', code:'OL-MAT-1122', kind:'enrollment', tutorId:'tp-olga', subjectId:'math',
      groupId:null, createdBy:'u-olga', createdAt:'2026-05-01', expiresAt:'2026-05-30',
      maxUses:5, usedCount:5, status:'expired',
      note:'Математика, весенний набор' },
    { id:'inv-4', code:'AN-FAM-8842', kind:'guardian', tutorId:null, subjectId:null,
      groupId:null, studentId:'s-anna', createdBy:'u-anna', createdAt:'2026-07-20',
      expiresAt:'2026-09-30', maxUses:2, usedCount:1, status:'active',
      note:'Доступ родителя к прогрессу Анны' },
  ];

  const goals = [
    { studentId:'s-anna',  subjectId:'inf',  targetScore:85, examDate:'2027-06-01' },
    { studentId:'s-anna',  subjectId:'math', targetScore:75, examDate:'2027-06-05' },
    { studentId:'s-petr',  subjectId:'inf',  targetScore:70, examDate:'2027-06-01' },
    { studentId:'s-mila',  subjectId:'inf',  targetScore:80, examDate:'2028-06-01' },
    { studentId:'s-kir',   subjectId:'inf',  targetScore:80, examDate:'2027-06-01' },
    { studentId:'s-sofia', subjectId:'inf',  targetScore:90, examDate:'2027-06-01' },
  ];

  /* Платежи не реализованы: это только состояние абонемента. */
  const subscriptions = [
    { id:'sub-anna',  studentId:'s-anna',  payerUserId:'u-elena', plan:'8 занятий', lessonsLeft:4, lessonsTotal:8, price:6000, nextChargeAt:'2026-08-15', status:'active' },
    { id:'sub-petr',  studentId:'s-petr',  payerUserId:'u-petr',  plan:'группа, месяц', lessonsLeft:1, lessonsTotal:8, price:4800, nextChargeAt:'2026-08-11', status:'active' },
    { id:'sub-mila',  studentId:'s-mila',  payerUserId:'u-mila',  plan:'4 занятия', lessonsLeft:0, lessonsTotal:4, price:3200, nextChargeAt:null, status:'paused' },
    { id:'sub-kir',   studentId:'s-kir',   payerUserId:'u-kir',   plan:'группа, месяц', lessonsLeft:5, lessonsTotal:8, price:4800, nextChargeAt:'2026-08-20', status:'active' },
    { id:'sub-sofia', studentId:'s-sofia', payerUserId:'u-sofia', plan:'группа, месяц', lessonsLeft:6, lessonsTotal:8, price:4800, nextChargeAt:'2026-08-22', status:'active' },
  ];

  const notificationPrefs = [
    { userId:'u-anna',  channel:'telegram', enabled:true,  handle:'@anna_kov' },
    { userId:'u-anna',  channel:'email',    enabled:false, handle:'anna.kov@mail.ru' },
    { userId:'u-anna',  channel:'lesson_reminder', enabled:true, minutesBefore:60 },
    { userId:'u-anna',  channel:'hw_deadline',     enabled:true, minutesBefore:1440 },
    { userId:'u-elena', channel:'telegram', enabled:true,  handle:'@e_kovaleva' },
    { userId:'u-elena', channel:'weekly_digest', enabled:true },
    { userId:'u-elena', channel:'missed_lesson', enabled:true },
    { userId:'u-elena', channel:'hw_overdue',    enabled:true },
  ];

  /* ── банк задач ──────────────────────────────────────────────────
     Парсер не реализован; ниже ровно та форма, которую он должен
     отдавать. Поле number — номер задания внутри экзамена предмета,
     а не «номер ЕГЭ по информатике»: у математики своя нумерация.
     ──────────────────────────────────────────────────────────────── */
  const taskShape = {
    id:'строка, уникальный',
    subjectId:'ссылка на subjects[].id',
    number:'номер задания внутри экзамена этого предмета',
    topicId:'ссылка на topics[].id (подставится по subject.exam.parts)',
    title:'короткий заголовок для списка',
    statement:'условие, простой текст',
    answer:'эталонный ответ строкой',
    answerType:'number | string | set',
    compare:'exact | ci | set | numeric',
    tolerance:'для compare=numeric — допустимое отклонение',
    autoCheck:'true | false — false там, где нужен разбор решения',
    difficulty:'1..3',
    source:'откуда импортировано',
  };

  const tasks = [
    /* ── информатика ── */
    { id:'q-5-1',  subjectId:'inf', number:5,  topicId:'t-num',  title:'Автомат и двоичная запись', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'Автомат получает на вход четырёхзначное число. По нему строится новое число: складываются первая и вторая цифры, затем вторая и третья, затем третья и четвёртая. Полученные суммы записываются подряд в порядке убывания. Укажите наименьшее число, при обработке которого автомат выдаёт 141312.', answer:'2839' },
    { id:'q-5-2',  subjectId:'inf', number:5,  topicId:'t-num',  title:'Наименьшее число для автомата', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'На вход подаётся натуральное число N. Алгоритм строит новое число R: пока N > 0, к R приписывается остаток от деления N на 3, N уменьшается втрое. Найдите наименьшее N > 100, для которого R содержит ровно четыре цифры.', answer:'108' },
    { id:'q-17-1', subjectId:'inf', number:17, topicId:'t-str',  title:'Обработка последовательности', autoCheck:true, answerType:'set', compare:'set', difficulty:3, source:'seed',
      statement:'В файле записана последовательность целых чисел. Найдите количество пар элементов, сумма которых кратна минимальному элементу последовательности, и максимальную из таких сумм. В ответе укажите два числа через пробел.', answer:'128 51872' },
    { id:'q-17-2', subjectId:'inf', number:17, topicId:'t-str',  title:'Пары с заданным свойством', autoCheck:true, answerType:'set', compare:'set', difficulty:3, source:'seed',
      statement:'Дана последовательность натуральных чисел. Найдите количество пар соседних элементов, произведение которых оканчивается на 4, и максимальное такое произведение. В ответе укажите два числа через пробел.', answer:'44 9744' },
    { id:'q-16-1', subjectId:'inf', number:16, topicId:'t-rec',  title:'Рекурсивная функция F(n)', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'Функция F(n) задана так: F(n) = n при n ≤ 3; F(n) = F(n−1) + 2·F(n−2) + 3·F(n−3) при n > 3. Чему равно значение F(12)?', answer:'11466' },
    { id:'q-16-2', subjectId:'inf', number:16, topicId:'t-rec',  title:'Сумма цифр значения F', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'F(n) = 1 при n = 1; F(n) = n + F(n−1) при чётном n; F(n) = 2·F(n−1) при нечётном n > 1. Найдите сумму цифр числа F(15).', answer:'19' },
    { id:'q-19-1', subjectId:'inf', number:19, topicId:'t-dp',   title:'Камни: выигрышная позиция', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'В куче S камней. Игроки по очереди берут 1 камень или увеличивают кучу вдвое. Выигрывает тот, после чьего хода в куче не менее 60 камней. Найдите минимальное S, при котором Петя выигрывает первым ходом.', answer:'30' },
    { id:'q-22-1', subjectId:'inf', number:22, topicId:'t-graph',title:'Кратчайший путь по таблице', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'В таблице задана схема дорог между городами. Определите длину кратчайшего пути из города A в город K, двигаясь только по указанным дорогам.', answer:'17' },
    { id:'q-23-1', subjectId:'inf', number:23, topicId:'t-graph',title:'Количество программ исполнителя', autoCheck:true, answerType:'number', compare:'exact', difficulty:3, source:'seed',
      statement:'Исполнитель умеет прибавлять 1 и умножать на 2. Сколько существует программ, переводящих число 2 в число 28 и не содержащих число 17?', answer:'104' },
    { id:'q-14-1', subjectId:'inf', number:14, topicId:'t-num',  title:'Основание системы счисления', autoCheck:true, answerType:'number', compare:'exact', difficulty:1, source:'seed',
      statement:'Найдите наименьшее основание системы счисления, в которой запись числа 250 оканчивается на две одинаковые цифры.', answer:'7' },
    { id:'q-2-1',  subjectId:'inf', number:2,  topicId:'t-log',  title:'Таблица истинности', autoCheck:true, answerType:'string', compare:'ci', difficulty:1, source:'seed',
      statement:'Логическая функция F задана выражением ¬x ∧ (y ∨ ¬z). Определите порядок столбцов таблицы истинности. В ответе запишите буквы без пробелов.', answer:'zyx' },
    { id:'q-27-1', subjectId:'inf', number:27, topicId:'t-sort', title:'Программа обработки файла', autoCheck:false, answerType:'string', compare:'exact', difficulty:3, source:'seed',
      statement:'Дан файл из N пар чисел. Требуется написать программу, которая находит максимальную сумму пары, кратную 26. Приложите код программы — задание проверяет репетитор.', answer:'' },

    /* ── математика: тот же формат, другой предмет ── */
    { id:'m-4-1',  subjectId:'math', number:4,  topicId:'m-prob', title:'Вероятность двух событий', autoCheck:true, answerType:'number', compare:'numeric', tolerance:0.001, difficulty:1, source:'seed',
      statement:'Вероятность того, что новый чайник прослужит больше года, равна 0,97. Вероятность того, что он прослужит больше двух лет, равна 0,89. Найдите вероятность того, что он прослужит меньше двух лет, но больше года.', answer:'0,08' },
    { id:'m-9-1',  subjectId:'math', number:9,  topicId:'m-text', title:'Движение по реке', autoCheck:true, answerType:'number', compare:'exact', difficulty:2, source:'seed',
      statement:'Моторная лодка прошла против течения 63 км и вернулась обратно, затратив на обратный путь на 2 часа меньше. Найдите скорость лодки в неподвижной воде, если скорость течения 2 км/ч.', answer:'16' },
    { id:'m-12-1', subjectId:'math', number:12, topicId:'m-trig', title:'Тригонометрическое уравнение', autoCheck:false, answerType:'string', compare:'exact', difficulty:3, source:'seed',
      statement:'Решите уравнение 2sin²x + 3cos x = 0 и найдите все его корни, принадлежащие отрезку [−3π; −3π/2]. Требуется полное решение — проверяет репетитор.', answer:'' },
    { id:'m-1-1',  subjectId:'math', number:1,  topicId:'m-plan', title:'Углы треугольника', autoCheck:true, answerType:'number', compare:'exact', difficulty:1, source:'seed',
      statement:'В треугольнике ABC угол A равен 48°, угол B равен 62°. Найдите внешний угол при вершине C. Ответ дайте в градусах.', answer:'110' },
  ];

  /* ── занятия ─────────────────────────────────────────────────────
     Занятие адресуется либо привязке (enrollmentId), либо группе
     (groupId). Посещаемость всегда per-student — иначе групповое
     занятие нельзя посчитать честно.
     ──────────────────────────────────────────────────────────────── */
  const d = (offsetDays, hh, mm) => {
    const x = new Date();
    x.setDate(x.getDate() + offsetDays);
    x.setHours(hh, mm || 0, 0, 0);
    return x.toISOString();
  };

  const CALL = { type:'call', label:'Яндекс Телемост', url:'https://telemost.yandex.ru/j/arcs-dm' };
  const BOARD = { type:'board', label:'Доска Excalidraw', url:'https://excalidraw.com/#room=arcs' };

  const lessons = [
    { id:'l-1', subjectId:'inf', tutorId:'tp-dm', enrollmentId:'e-anna-inf', groupId:null,
      startsAt:d(0,16), durationMin:90, status:'planned',
      links:[CALL, BOARD, { type:'material', label:'Конспект: динамика на отрезках', url:'#' }],
      taskIds:['q-17-1','q-19-1','q-16-1'] },
    { id:'l-2', subjectId:'inf', tutorId:'tp-dm', enrollmentId:'e-anna-inf', groupId:null,
      startsAt:d(-2,16), durationMin:90, status:'done', links:[CALL], taskIds:['q-16-2','q-5-1'],
      note:{ visibility:'parent', topics:['t-rec'], text:'Разобрали рекурсию, база даётся тяжело — дал дополнительные задачи.' } },
    { id:'l-3', subjectId:'inf', tutorId:'tp-dm', enrollmentId:'e-anna-inf', groupId:null,
      startsAt:d(-4,16), durationMin:90, status:'done', links:[CALL], taskIds:['q-14-1'],
      note:{ visibility:'student', topics:['t-num'], text:'Системы счисления на автомате. Молодец.' } },
    { id:'l-4', subjectId:'inf', tutorId:'tp-dm', enrollmentId:'e-anna-inf', groupId:null,
      startsAt:d(-7,16), durationMin:90, status:'moved', links:[], taskIds:[] },
    { id:'l-5', subjectId:'inf', tutorId:'tp-dm', enrollmentId:'e-anna-inf', groupId:null,
      startsAt:d(-9,16), durationMin:90, status:'missed', links:[], taskIds:[] },
    { id:'l-6', subjectId:'inf', tutorId:'tp-dm', enrollmentId:'e-anna-inf', groupId:null,
      startsAt:d(3,16), durationMin:90, status:'planned', links:[CALL], taskIds:[] },

    /* математика — второй предмет того же ученика */
    { id:'l-m1', subjectId:'math', tutorId:'tp-olga', enrollmentId:'e-anna-math', groupId:null,
      startsAt:d(1,18), durationMin:60, status:'planned',
      links:[{ type:'call', label:'Телемост Ольги', url:'https://telemost.yandex.ru/j/arcs-olga' }],
      taskIds:['m-9-1','m-12-1'] },
    { id:'l-m2', subjectId:'math', tutorId:'tp-olga', enrollmentId:'e-anna-math', groupId:null,
      startsAt:d(-5,18), durationMin:60, status:'done', links:[], taskIds:['m-4-1'] },

    /* групповые занятия */
    { id:'l-g1', subjectId:'inf', tutorId:'tp-dm', enrollmentId:null, groupId:'gr-inf-evening',
      startsAt:d(0,19), durationMin:120, status:'planned',
      links:[CALL, BOARD], taskIds:['q-2-1','q-14-1'] },
    { id:'l-g2', subjectId:'inf', tutorId:'tp-dm', enrollmentId:null, groupId:'gr-inf-evening',
      startsAt:d(-2,19), durationMin:120, status:'done', links:[CALL], taskIds:['q-22-1'] },
    { id:'l-g3', subjectId:'inf', tutorId:'tp-dm', enrollmentId:null, groupId:'gr-inf-evening',
      startsAt:d(-7,19), durationMin:120, status:'done', links:[CALL], taskIds:[] },
  ].concat(lessonHistory());

  /* еженедельные занятия за прошедшие 3 месяца — база для посещаемости */
  function lessonHistory() {
    const out = [];
    for (let w = 2; w <= 13; w++) {
      out.push({ id:'l-h' + w, subjectId:'inf', tutorId:'tp-dm', enrollmentId:'e-anna-inf', groupId:null,
        startsAt:d(-7 * w, 16), durationMin:90, status: w === 6 ? 'moved' : 'done',
        links:[], taskIds:[] });
    }
    return out;
  }

  /* посещаемость: для группового занятия по строке на участника */
  const lessonAttendance = [
    { lessonId:'l-g2', studentId:'s-petr',  status:'present' },
    { lessonId:'l-g2', studentId:'s-kir',   status:'present' },
    { lessonId:'l-g2', studentId:'s-sofia', status:'absent'  },
    { lessonId:'l-g3', studentId:'s-petr',  status:'present' },
    { lessonId:'l-g3', studentId:'s-kir',   status:'late'    },
    { lessonId:'l-g3', studentId:'s-sofia', status:'present' },
  ];

  /* ── домашние задания ────────────────────────────────────────── */
  const assignments = [
    { id:'a-1', subjectId:'inf', enrollmentId:'e-anna-inf', groupId:null, lessonId:'l-3',
      title:'Д/З №3 — обработка последовательностей', dueAt:d(-2,20), taskIds:['q-17-2','q-5-2'] },
    { id:'a-2', subjectId:'inf', enrollmentId:'e-anna-inf', groupId:null, lessonId:'l-2',
      title:'Д/З №4 — динамика и рекурсия', dueAt:d(2,20), taskIds:['q-19-1','q-16-2'] },
    { id:'a-3', subjectId:'inf', enrollmentId:'e-anna-inf', groupId:null, lessonId:'l-2',
      title:'Повторить: рекурсия, базовый случай', dueAt:d(3,20), taskIds:['q-16-1'] },
    { id:'a-4', subjectId:'inf', enrollmentId:'e-anna-inf', groupId:null, lessonId:'l-3',
      title:'Пробный вариант — часть 2', dueAt:d(-1,20), taskIds:['q-27-1'] },
    { id:'a-m1', subjectId:'math', enrollmentId:'e-anna-math', groupId:null, lessonId:'l-m2',
      title:'Математика: вероятность и текстовые задачи', dueAt:d(4,20), taskIds:['m-4-1','m-9-1'] },
    /* групповое задание — выдаётся всей группе разом */
    { id:'a-g1', subjectId:'inf', enrollmentId:null, groupId:'gr-inf-evening', lessonId:'l-g2',
      title:'Группа: графы и кратчайшие пути', dueAt:d(1,20), taskIds:['q-22-1','q-23-1'] },
  ];

  /* ── пробники ────────────────────────────────────────────────── */
  const mockExams = [
    { id:'m-1', studentId:'s-anna', subjectId:'inf', variant:'Вариант 1', date:d(-130,12), primary:11 },
    { id:'m-2', studentId:'s-anna', subjectId:'inf', variant:'Вариант 2', date:d(-100,12), primary:12 },
    { id:'m-3', studentId:'s-anna', subjectId:'inf', variant:'Вариант 3', date:d(-72,12),  primary:14 },
    { id:'m-4', studentId:'s-anna', subjectId:'inf', variant:'Вариант 4', date:d(-45,12),  primary:15 },
    { id:'m-5', studentId:'s-anna', subjectId:'inf', variant:'Вариант 5', date:d(-18,12),  primary:17 },
    { id:'m-6', studentId:'s-anna', subjectId:'inf', variant:'Вариант 6', date:d(-4,12),   primary:18 },
    { id:'mm-1', studentId:'s-anna', subjectId:'math', variant:'Вариант 1', date:d(-40,12), primary:9 },
    { id:'mm-2', studentId:'s-anna', subjectId:'math', variant:'Вариант 2', date:d(-12,12), primary:12 },
    { id:'mp-1', studentId:'s-petr', subjectId:'inf', variant:'Вариант 1', date:d(-30,12), primary:9 },
    { id:'mp-2', studentId:'s-petr', subjectId:'inf', variant:'Вариант 2', date:d(-6,12),  primary:11 },
    { id:'mk-1', studentId:'s-kir',  subjectId:'inf', variant:'Вариант 1', date:d(-20,12), primary:15 },
    { id:'ms-1', studentId:'s-sofia',subjectId:'inf', variant:'Вариант 1', date:d(-15,12), primary:19 },
  ].map(m => Object.assign(m, { items: mockItems(m.subjectId, m.primary) }));

  /* раскладывает первичный балл по номерам заданий предмета */
  function mockItems(subjectId, primary) {
    const subj = subjects.find(s => s.id === subjectId);
    const parts = subj.exam.parts;
    const order = parts.slice().sort((a, b) => a.maxPoints - b.maxPoints || a.number - b.number);
    let left = primary;
    const got = {};
    order.forEach(p => { const take = Math.max(0, Math.min(p.maxPoints, left)); got[p.number] = take; left -= take; });
    return parts.map(p => ({ number:p.number, got:got[p.number] || 0, max:p.maxPoints }));
  }

  /* ── попытки решения ─────────────────────────────────────────── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedAttempts() {
    const out = [];
    const plan = [
      { sid:'s-anna',  subjectId:'inf',  days:90, seed:20260807, rate:1 },
      { sid:'s-anna',  subjectId:'math', days:45, seed:31415926, rate:.5 },
      { sid:'s-petr',  subjectId:'inf',  days:60, seed:11223344, rate:.6 },
      { sid:'s-kir',   subjectId:'inf',  days:60, seed:55667788, rate:.7 },
      { sid:'s-sofia', subjectId:'inf',  days:60, seed:99001122, rate:.8 },
    ];
    plan.forEach(cfg => {
      const rnd = mulberry32(cfg.seed);
      const pool = tasks.filter(t => t.autoCheck && t.subjectId === cfg.subjectId);
      if (!pool.length) return;
      for (let back = cfg.days; back >= 1; back--) {
        const dt = new Date(); dt.setDate(dt.getDate() - back); dt.setHours(19, 0, 0, 0);
        const dow = dt.getDay();
        let n = rnd() < (dow === 0 || dow === 6 ? .45 : .78) * cfg.rate ? 1 + Math.floor(rnd() * 4) : 0;
        if (back <= 2 && cfg.sid === 's-anna' && cfg.subjectId === 'inf') n = Math.max(n, 2);
        for (let i = 0; i < n; i++) {
          const task = pool[Math.floor(rnd() * pool.length)];
          const progress = (cfg.days - back) / cfg.days;
          const base = { 1:.9, 2:.75, 3:.55 }[task.difficulty] || .7;
          const p = Math.min(.95, base * (.72 + .45 * progress));
          const correct = rnd() < p;
          const secs = Math.round((160 + rnd() * 900) * (task.difficulty / 2));
          const at = new Date(dt); at.setMinutes(at.getMinutes() + i * 17);
          out.push({
            id: 'at-' + cfg.sid + '-' + cfg.subjectId + '-' + back + '-' + i,
            taskId: task.id, studentId: cfg.sid, subjectId: cfg.subjectId,
            context: rnd() < .35 ? 'lesson' : 'homework',
            lessonId: null, assignmentId: null, groupId: null,
            code: '', answer: correct ? task.answer : 'x',
            tries: correct ? (rnd() < .6 ? 1 : 2) : 2,
            isCorrect: correct, firstTryCorrect: correct && rnd() < .65,
            activeSeconds: secs, status: 'checked',
            startedAt: at.toISOString(), submittedAt: at.toISOString(),
          });
        }
      }
    });
    return out;
  }

  function boundAttempts() {
    const mk = (id, taskId, over) => {
      const t = tasks.find(x => x.id === taskId);
      return Object.assign({
        id, taskId, studentId:'s-anna', subjectId: t ? t.subjectId : 'inf',
        context:'homework', lessonId:null, assignmentId:null, groupId:null,
        code:'', answer:'', tries:0, isCorrect:null, firstTryCorrect:null,
        activeSeconds:0, status:'issued', startedAt:null, submittedAt:null,
      }, over);
    };
    return [
      mk('at-a1-1','q-17-2',{ assignmentId:'a-1', answer:'44 9744', tries:1, isCorrect:true, firstTryCorrect:true, activeSeconds:1580, status:'checked', startedAt:d(-3,19), submittedAt:d(-3,19) }),
      mk('at-a1-2','q-5-2', { assignmentId:'a-1', activeSeconds:420, status:'in_progress', startedAt:d(-3,20), code:'n = 100\nwhile True:\n    ' }),
      mk('at-a2-1','q-19-1',{ assignmentId:'a-2', answer:'30', tries:1, isCorrect:true, firstTryCorrect:true, activeSeconds:960, status:'checked', startedAt:d(-1,18), submittedAt:d(-1,18) }),
      mk('at-a2-2','q-16-2',{ assignmentId:'a-2', status:'issued' }),
      mk('at-a3-1','q-16-1',{ assignmentId:'a-3', status:'issued' }),
      mk('at-a4-1','q-27-1',{ assignmentId:'a-4', status:'submitted', activeSeconds:2760, startedAt:d(-2,17), submittedAt:d(-1,15),
        code:'f = open("27-A.txt")\nn = int(f.readline())\nbest = 0\nfor line in f:\n    a, b = map(int, line.split())\n    s = a + b\n    if s % 26 == 0 and s > best:\n        best = s\nprint(best)' }),
      mk('at-m1-1','m-4-1',{ assignmentId:'a-m1', status:'issued' }),
      mk('at-m1-2','m-9-1',{ assignmentId:'a-m1', status:'issued' }),
      mk('at-l1-1','q-17-1',{ context:'lesson', lessonId:'l-1', status:'issued' }),
      mk('at-l1-2','q-19-1',{ context:'lesson', lessonId:'l-1', status:'issued' }),
      mk('at-l1-3','q-16-1',{ context:'lesson', lessonId:'l-1', status:'issued' }),
    ].concat(groupAttempts());
  }

  /* групповое задание разворачивается в попытку на каждого участника */
  function groupAttempts() {
    const out = [];
    assignments.filter(a => a.groupId).forEach(a => {
      groupMembers.filter(m => m.groupId === a.groupId && m.status === 'active').forEach((m, mi) => {
        a.taskIds.forEach((taskId, ti) => {
          const t = tasks.find(x => x.id === taskId);
          const solved = (mi + ti) % 3 !== 0;
          out.push({
            id: 'at-' + a.id + '-' + m.studentId + '-' + ti,
            taskId, studentId:m.studentId, subjectId:a.subjectId,
            context:'homework', lessonId:null, assignmentId:a.id, groupId:a.groupId,
            code:'', answer: solved ? t.answer : '',
            tries: solved ? 1 : 0, isCorrect: solved ? true : null,
            firstTryCorrect: solved, activeSeconds: solved ? 600 + mi * 220 + ti * 130 : 0,
            status: solved ? 'checked' : 'issued',
            startedAt: solved ? d(-1, 17) : null, submittedAt: solved ? d(-1, 17) : null,
          });
        });
      });
    });
    return out;
  }

  /* ── сборка и хранение ───────────────────────────────────────── */
  function build() {
    return {
      generatedAt:new Date().toISOString(),
      subjects, topics, users, studentProfiles, tutorProfiles, guardians,
      enrollments, groups, groupMembers, invites, goals, subscriptions,
      notificationPrefs, taskShape, tasks, lessons, lessonAttendance,
      assignments, mockExams,
      attempts: boundAttempts().concat(seedAttempts()),
    };
  }

  let state = null;

  function load() {
    if (state) return state;
    const fresh = build();
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved) {
        if (saved.importedTasks && saved.importedTasks.length) {
          const have = new Set(fresh.tasks.map(t => t.id));
          saved.importedTasks.forEach(t => { if (!have.has(t.id)) fresh.tasks.push(t); });
        }
        if (saved.attempts) {
          const byId = new Map(saved.attempts.map(a => [a.id, a]));
          fresh.attempts = fresh.attempts.map(a => byId.has(a.id) ? Object.assign({}, a, byId.get(a.id)) : a);
          saved.attempts.forEach(a => { if (!fresh.attempts.some(x => x.id === a.id)) fresh.attempts.push(a); });
        }
        if (saved.prefs) fresh.notificationPrefs = saved.prefs;
        if (saved.lessonTasks) fresh.lessons.forEach(l => {
          if (saved.lessonTasks[l.id]) l.taskIds = saved.lessonTasks[l.id];
        });
        if (saved.enrollments) saved.enrollments.forEach(e => {
          if (!fresh.enrollments.some(x => x.id === e.id)) fresh.enrollments.push(e);
        });
        if (saved.groupMembers) saved.groupMembers.forEach(m => {
          if (!fresh.groupMembers.some(x => x.groupId === m.groupId && x.studentId === m.studentId))
            fresh.groupMembers.push(m);
        });
        if (saved.invites) saved.invites.forEach(i => {
          const cur = fresh.invites.find(x => x.id === i.id);
          if (cur) Object.assign(cur, i); else fresh.invites.push(i);
        });
      }
    } catch (e) { /* поехавший localStorage не должен ронять страницу */ }
    state = fresh;
    return state;
  }

  function save() {
    if (!state) return;
    const slim = state.attempts.map(a => ({
      id:a.id, taskId:a.taskId, studentId:a.studentId, subjectId:a.subjectId,
      context:a.context, lessonId:a.lessonId, assignmentId:a.assignmentId, groupId:a.groupId,
      answer:a.answer, tries:a.tries, isCorrect:a.isCorrect, firstTryCorrect:a.firstTryCorrect,
      activeSeconds:a.activeSeconds, status:a.status,
      startedAt:a.startedAt, submittedAt:a.submittedAt, code:a.code,
    }));
    const lessonTasks = {};
    state.lessons.forEach(l => { lessonTasks[l.id] = l.taskIds; });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        attempts:slim, prefs:state.notificationPrefs, lessonTasks,
        importedTasks: state.tasks.filter(t => t.source !== 'seed'),
        enrollments: state.enrollments.filter(e => e.source === 'invite-accepted'),
        groupMembers: state.groupMembers.filter(m => m.source === 'invite-accepted'),
        invites: state.invites,
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
