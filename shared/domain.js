/* ═══════════════════════════════════════════════════════════════════
   ДОМЕННЫЕ СПРАВОЧНИКИ

   Предметы с сеткой экзамена, темы и генератор банка задач.
   Один и тот же модуль используется сервером (для заполнения БД)
   и не зависит ни от браузера, ни от базы.
   ═══════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Domain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

/* ── шкалы перевода первичного балла в тестовый ──────────────── */
const SCALE_INF = [0,7,14,20,27,34,40,43,46,48,51,54,56,59,62,64,67,70,72,75,
                   78,80,83,85,88,90,93,95,97,100];
const SCALE_MATH = [0,6,11,17,22,27,34,40,46,52,58,64,66,68,70,72,74,76,78,80,
                    82,84,86,88,90,92,94,96,98,99,100,100,100];

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
  [15,2,'m-text'],[16,4,'m-plan'],[17,4,'m-param'],[18,5,'m-theory'],
];
const mkParts = rows => rows.map(([number, maxPoints, topicId]) => ({ number, maxPoints, topicId }));

const subjects = [
  { id:'inf', name:'Информатика', short:'Инф', slug:'inf', color:'blue',
    exam:{ name:'ЕГЭ', scale:SCALE_INF, parts:mkParts(partsInf) } },
  { id:'math', name:'Математика (профиль)', short:'Матем', slug:'math', color:'violet',
    exam:{ name:'ЕГЭ', scale:SCALE_MATH, parts:mkParts(partsMath) } },
];

const topics = [
  { id:'t-num',   subjectId:'inf', name:'Системы счисления' },
  { id:'t-log',   subjectId:'inf', name:'Логика и таблицы истинности' },
  { id:'t-rec',   subjectId:'inf', name:'Рекурсия' },
  { id:'t-dp',    subjectId:'inf', name:'Динамическое программирование' },
  { id:'t-graph', subjectId:'inf', name:'Графы' },
  { id:'t-str',   subjectId:'inf', name:'Обработка строк' },
  { id:'t-sort',  subjectId:'inf', name:'Сортировка и поиск' },
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

/* ── генерация банка задач ───────────────────────────────────────
   Временный банк вместо парсера. Числа в условии и ответ считаются
   из одного зерна, поэтому ответы верные и автопроверка настоящая.
   Когда появится парсер, он положит записи той же формы сюда же.
   ──────────────────────────────────────────────────────────────── */
function rng(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

const T = {
  /* ── информатика ── */
  't-log': [
    (r) => { const n = pick(r, 4, 8);
      return { title:'Число наборов переменных',
        statement:`Сколько существует различных наборов значений логических переменных x₁, x₂, …, x${n}?`,
        answer:String(Math.pow(2, n)), type:'number', compare:'exact', diff:1 }; },
    (r) => { const a = pick(r, 2, 5), b = pick(r, 2, 5);
      const cnt = (() => { let c = 0; for (let x = 0; x < 8; x++) {
        const p = !!(x & 4), q = !!(x & 2), s = !!(x & 1);
        if (((p || q) && !s) === true) c++; } return c; })();
      return { title:'Строки таблицы истинности',
        statement:`Логическая функция F задана выражением (x ∨ y) ∧ ¬z. Сколько строк таблицы истинности функции F содержат значение «истина»? Переменные принимают значения 0 и 1.`,
        answer:String(cnt), type:'number', compare:'exact', diff:2, hint:`${a}${b}` }; },
  ],
  't-num': [
    (r) => { const n = pick(r, 120, 900), b = pick(r, 2, 8);
      return { title:`Перевод числа в основание ${b}`,
        statement:`Переведите десятичное число ${n} в систему счисления с основанием ${b}. В ответе запишите только цифры результата.`,
        answer:n.toString(b).toUpperCase(), type:'string', compare:'ci', diff:1 }; },
    (r) => { const n = pick(r, 200, 4000);
      const ones = n.toString(2).split('').filter(c => c === '1').length;
      return { title:'Единицы в двоичной записи',
        statement:`Сколько единиц содержится в двоичной записи десятичного числа ${n}?`,
        answer:String(ones), type:'number', compare:'exact', diff:1 }; },
    (r) => { const n = pick(r, 60, 400);
      let c = 0; for (let d = 1; d <= n; d++) if (n % d === 0) c++;
      return { title:'Количество делителей',
        statement:`Сколько натуральных делителей имеет число ${n}? Единица и само число тоже считаются делителями.`,
        answer:String(c), type:'number', compare:'exact', diff:2 }; },
  ],
  't-rec': [
    (r) => { const n = pick(r, 9, 14);
      const F = m => { const f = [0, 1, 2, 3]; for (let i = 4; i <= m; i++) f[i] = f[i-1] + 2*f[i-2] + 3*f[i-3]; return f[m]; };
      return { title:`Рекурсивная функция F(${n})`,
        statement:`Функция F(n) задана так: F(n) = n при n ≤ 3; F(n) = F(n−1) + 2·F(n−2) + 3·F(n−3) при n > 3. Чему равно значение F(${n})?`,
        answer:String(F(n)), type:'number', compare:'exact', diff:2 }; },
    (r) => { const n = pick(r, 10, 16);
      const F = m => { let v = 1; for (let i = 2; i <= m; i++) v = (i % 2 === 0) ? v + i : v * 2; return v; };
      const val = F(n);
      const ds = String(val).split('').reduce((s, c) => s + (+c), 0);
      return { title:'Сумма цифр значения F',
        statement:`F(1) = 1; при чётном n: F(n) = n + F(n−1); при нечётном n > 1: F(n) = 2·F(n−1). Найдите сумму цифр числа F(${n}).`,
        answer:String(ds), type:'number', compare:'exact', diff:2 }; },
  ],
  't-dp': [
    (r) => { const m = pick(r, 4, 8), n = pick(r, 4, 8);
      const dp = Array.from({length:m}, () => Array(n).fill(1));
      for (let i = 1; i < m; i++) for (let j = 1; j < n; j++) dp[i][j] = dp[i-1][j] + dp[i][j-1];
      return { title:'Пути робота по таблице',
        statement:`Робот стоит в левом верхнем углу таблицы ${m}×${n} и может двигаться только вправо и вниз. Сколько существует различных путей в правый нижний угол?`,
        answer:String(dp[m-1][n-1]), type:'number', compare:'exact', diff:2 }; },
    (r) => { const a = pick(r, 100, 400), b = a + pick(r, 200, 900), k = pick(r, 3, 9);
      const c = Math.floor(b / k) - Math.floor((a - 1) / k);
      return { title:'Количество кратных в диапазоне',
        statement:`Сколько существует целых чисел в диапазоне от ${a} до ${b} включительно, которые делятся на ${k} без остатка?`,
        answer:String(c), type:'number', compare:'exact', diff:1 }; },
  ],
  't-graph': [
    (r) => { const x = pick(r, 2, 4), y = pick(r, 20, 40);
      const memo = {};
      const f = v => { if (v > y) return 0; if (v === y) return 1;
        if (memo[v] != null) return memo[v]; return memo[v] = f(v + 1) + f(v * 2); };
      return { title:'Программы исполнителя',
        statement:`Исполнитель умеет прибавлять 1 и умножать на 2. Сколько существует программ, которые переводят число ${x} в число ${y}?`,
        answer:String(f(x)), type:'number', compare:'exact', diff:3 }; },
    (r) => { const n = pick(r, 5, 7);
      const w = []; for (let i = 0; i < n - 1; i++) w.push(pick(r, 2, 9));
      const total = w.reduce((s, v) => s + v, 0);
      const letters = 'ABCDEFGH'.slice(0, n).split('');
      const desc = w.map((v, i) => `${letters[i]}–${letters[i+1]} = ${v}`).join(', ');
      return { title:'Длина пути по маршруту',
        statement:`Между городами проложены дороги: ${desc}. Другие дороги отсутствуют. Найдите длину пути из города ${letters[0]} в город ${letters[n-1]}.`,
        answer:String(total), type:'number', compare:'exact', diff:2 }; },
  ],
  't-str': [
    (r) => { const lo = pick(r, 100, 500), hi = lo + pick(r, 300, 900), k = pick(r, 7, 14);
      let c = 0; for (let i = lo; i <= hi; i++)
        if (String(i).split('').reduce((s, ch) => s + (+ch), 0) === k) c++;
      return { title:'Числа с заданной суммой цифр',
        statement:`Сколько целых чисел в диапазоне от ${lo} до ${hi} включительно имеют сумму цифр, равную ${k}?`,
        answer:String(c), type:'number', compare:'exact', diff:2 }; },
    (r) => { const lo = pick(r, 1000, 3000), hi = lo + pick(r, 400, 1200), d = pick(r, 2, 9);
      const arr = []; for (let i = lo; i <= hi; i++) if (i % d === 0) arr.push(i);
      return { title:'Количество и максимум',
        statement:`Дана последовательность целых чисел от ${lo} до ${hi} включительно. Найдите количество чисел, кратных ${d}, и наибольшее из них. В ответе запишите два числа через пробел.`,
        answer:`${arr.length} ${arr[arr.length-1]}`, type:'set', compare:'set', diff:3 }; },
  ],
  't-sort': [
    (r) => { const n = pick(r, 8, 14), k = pick(r, 3, 6);
      const arr = []; const rr = r;
      for (let i = 0; i < n; i++) arr.push(pick(rr, 10, 99));
      const sorted = arr.slice().sort((a, b) => a - b);
      return { title:'Элемент после сортировки',
        statement:`Дан массив: ${arr.join(', ')}. Массив отсортировали по возрастанию. Какое число окажется на ${k}-м месте (нумерация с единицы)?`,
        answer:String(sorted[k-1]), type:'number', compare:'exact', diff:1 }; },
    () => ({ title:'Программа обработки файла', manual:true,
      statement:'В файле записана последовательность пар натуральных чисел. Напишите программу, которая находит максимальную сумму пары, кратную 26. Приложите код решения — задание проверяет репетитор.',
      answer:'', type:'string', compare:'exact', diff:3 }),
  ],
  /* ── математика ── */
  'm-prob': [
    (r) => { const p1 = pick(r, 90, 98) / 100, p2 = pick(r, 70, 88) / 100;
      const res = Math.round((p1 - p2) * 1000) / 1000;
      return { title:'Вероятность промежутка',
        statement:`Вероятность того, что прибор проработает больше года, равна ${p1.toFixed(2).replace('.', ',')}. Вероятность того, что он проработает больше двух лет, равна ${p2.toFixed(2).replace('.', ',')}. Найдите вероятность того, что прибор проработает меньше двух лет, но больше года.`,
        answer:String(res).replace('.', ','), type:'number', compare:'numeric', tol:0.0011, diff:1 }; },
    (r) => { const n = pick(r, 4, 8), k = pick(r, 2, 3);
      const res = Math.round((k / n) * 1000) / 1000;
      return { title:'Классическая вероятность',
        statement:`В урне ${n} шаров, из них ${k} белых. Наудачу извлекают один шар. Найдите вероятность того, что он белый. Ответ округлите до тысячных.`,
        answer:String(res).replace('.', ','), type:'number', compare:'numeric', tol:0.0011, diff:1 }; },
  ],
  'm-text': [
    (r) => { const v = pick(r, 10, 20), c = pick(r, 1, 4), s = v * v - c * c;
      return { title:'Движение по реке',
        statement:`Моторная лодка прошла против течения ${s} км и вернулась обратно. Скорость течения ${c} км/ч. Найдите собственную скорость лодки, если разница во времени составила ${(2 * s * c / (v * v - c * c)).toFixed(0)} ч. Ответ в км/ч.`,
        answer:String(v), type:'number', compare:'exact', diff:2 }; },
    (r) => { const base = pick(r, 200, 900), pc = pick(r, 5, 25);
      return { title:'Проценты',
        statement:`Товар стоил ${base} рублей. Цену повысили на ${pc}%. Сколько рублей стал стоить товар?`,
        answer:String(Math.round(base * (1 + pc / 100))), type:'number', compare:'exact', diff:1 }; },
  ],
  'm-plan': [
    (r) => { const a = pick(r, 30, 70), b = pick(r, 30, 70);
      return { title:'Внешний угол треугольника',
        statement:`В треугольнике ABC угол A равен ${a}°, угол B равен ${b}°. Найдите внешний угол при вершине C. Ответ дайте в градусах.`,
        answer:String(a + b), type:'number', compare:'exact', diff:1 }; },
    () => ({ title:'Планиметрия: полное решение', manual:true,
      statement:'В треугольнике ABC биссектриса угла A пересекает сторону BC в точке K. Докажите, что BK : KC = AB : AC, и найдите BK, если AB = 12, AC = 18, BC = 20. Требуется полное решение.',
      answer:'', type:'string', compare:'exact', diff:3 }),
  ],
  'm-stereo': [
    (r) => { const a = pick(r, 2, 9), h = pick(r, 3, 12);
      return { title:'Объём прямоугольного параллелепипеда',
        statement:`Найдите объём прямоугольного параллелепипеда, если стороны основания равны ${a} и ${a + 1}, а высота равна ${h}.`,
        answer:String(a * (a + 1) * h), type:'number', compare:'exact', diff:1 }; },
    () => ({ title:'Сечение призмы', manual:true,
      statement:'В правильной шестиугольной призме постройте сечение, проходящее через три указанные точки, и найдите его площадь. Требуется полное решение с чертежом.',
      answer:'', type:'string', compare:'exact', diff:3 }),
  ],
  'm-func': [
    (r) => { const a = pick(r, 2, 6), b = pick(r, 1, 9);
      return { title:'Минимум квадратичной функции',
        statement:`Найдите наименьшее значение функции y = ${a}x² − ${2 * a * b}x + ${a * b * b + 5}.`,
        answer:'5', type:'number', compare:'exact', diff:2 }; },
    (r) => { const k = pick(r, 2, 8), b = pick(r, 1, 15);
      return { title:'Значение линейной функции',
        statement:`Прямая задана уравнением y = ${k}x + ${b}. Найдите значение y при x = ${k}.`,
        answer:String(k * k + b), type:'number', compare:'exact', diff:1 }; },
  ],
  'm-vect': [
    (r) => { const x1 = pick(r, 1, 9), y1 = pick(r, 1, 9), x2 = pick(r, 1, 9), y2 = pick(r, 1, 9);
      return { title:'Скалярное произведение',
        statement:`Даны векторы a = (${x1}; ${y1}) и b = (${x2}; ${y2}). Найдите их скалярное произведение.`,
        answer:String(x1 * x2 + y1 * y2), type:'number', compare:'exact', diff:1 }; },
  ],
  'm-trig':   [() => ({ title:'Тригонометрическое уравнение', manual:true,
    statement:'Решите уравнение 2sin²x + 3cos x = 0 и найдите все корни, принадлежащие отрезку [−3π; −3π/2]. Требуется полное решение.',
    answer:'', type:'string', compare:'exact', diff:3 })],
  'm-ineq':   [() => ({ title:'Неравенство', manual:true,
    statement:'Решите неравенство log₂(x² − 3x) ≤ log₂(2x + 6). Требуется полное решение с областью определения.',
    answer:'', type:'string', compare:'exact', diff:3 })],
  'm-param':  [() => ({ title:'Задача с параметром', manual:true,
    statement:'Найдите все значения параметра a, при которых уравнение x² − 2ax + a + 6 = 0 имеет два различных положительных корня. Требуется полное решение.',
    answer:'', type:'string', compare:'exact', diff:3 })],
  'm-theory': [() => ({ title:'Теория чисел', manual:true,
    statement:'Найдите все натуральные n, при которых число n² + 3n + 2 является произведением ровно четырёх простых множителей (с учётом кратности). Требуется полное решение.',
    answer:'', type:'string', compare:'exact', diff:3 })],
};

function generateTasks() {
  const out = [];
  subjects.forEach(subj => {
    subj.exam.parts.forEach(part => {
      const gens = T[part.topicId] || T['t-num'];
      const count = Math.min(gens.length, 3);
      for (let k = 0; k < count; k++) {
        const r = rng(subj.id + ':' + part.number + ':' + k);
        const g = gens[k](r, part);
        /* задания с большим весом требуют полного решения */
        const manual = !!g.manual || (subj.id === 'inf' && part.number === 27);
        out.push({
          id: `${subj.id}-${part.number}-${k + 1}`,
          subjectId: subj.id, number: part.number, topicId: part.topicId,
          title: g.title, statement: g.statement,
          answer: manual ? '' : g.answer,
          answerType: g.type, compare: g.compare, tolerance: g.tol || 0,
          autoCheck: !manual, difficulty: g.diff || 2, source: 'generated',
        });
      }
    });
  });
  return out;
}

const tasks = generateTasks();


return { subjects, topics, generateTasks, taskShape: {
  id:'строка', subjectId:'ссылка на предмет', number:'номер в сетке предмета',
  topicId:'тема', title:'заголовок', statement:'условие', answer:'эталон',
  answerType:'number|string|set', compare:'exact|ci|set|numeric',
  autoCheck:'true|false', difficulty:'1..3', source:'откуда',
} };
});
