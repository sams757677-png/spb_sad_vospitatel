// Подключаем библиотеки
const express  = require('express');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');

const приложение = express();
const база = new Database(path.join(__dirname, 'data.db'));

/* ============================================================
   СХЕМА БАЗЫ ДАННЫХ
   ============================================================ */
база.exec(`
  CREATE TABLE IF NOT EXISTS state (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    json       TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
`);

/* ============================================================
   НАСТРОЙКИ СЕРВЕРА
   ============================================================ */
const ПОРТ            = process.env.PORT || 3000;
const ПАРОЛЬ_АДМИНА   = process.env.ADMIN_PASSWORD || '03pa30ra';
const ХЭШ_ПАРОЛЯ      = crypto.createHash('sha256').update(ПАРОЛЬ_АДМИНА).digest('hex');

/* ============================================================
   НАЧАЛЬНЫЕ ДАННЫЕ
   ============================================================ */
const РАСПИСАНИЕ = [
  { day: 'Понедельник', items: ['Развитие речи', 'Физкультура', 'Лепка'] },
  { day: 'Вторник',     items: ['Математика', 'Музыка', 'Рисование'] },
  { day: 'Среда',       items: ['Окружающий мир', 'Физкультура', 'Аппликация'] },
  { day: 'Четверг',     items: ['Развитие речи', 'Конструирование', 'Музыка'] },
  { day: 'Пятница',     items: ['Математика', 'Рисование', 'Физкультура на улице'] }
];

const НАЧАЛЬНОЕ_СОСТОЯНИЕ = {
  settings: {
    browserTitle: 'Кабинет воспитателя',
    pageTitle:    'Кабинет воспитателя',
    pageSubtitle: 'Управление группами детского сада',
    welcomeText:  ''
  },
  groups: [
    { id: 'sun', emoji: '☀️', name: 'Солнышко', subtitle: 'Ясельная группа',
      c1: '#FBBF24', c2: '#E07A00',
      children: ['Аня Иванова', 'Миша Петров', 'Лиза Соколова', 'Тимоша Кузнецов'],
      schedule: РАСПИСАНИЕ, notes: '' },
    { id: 'drop', emoji: '💧', name: 'Капелька', subtitle: 'Младшая группа',
      c1: '#60A5FA', c2: '#2563EB',
      children: ['Ваня Смирнов', 'Соня Волкова', 'Артём Новиков', 'Даша Морозова', 'Кирилл Зайцев'],
      schedule: РАСПИСАНИЕ, notes: '' },
    { id: 'flower', emoji: '🌼', name: 'Ромашка', subtitle: 'Средняя группа',
      c1: '#6EE7B7', c2: '#0D9488',
      children: ['Маша Козлова', 'Егор Лебедев', 'Полина Орлова', 'Дима Фролов'],
      schedule: РАСПИСАНИЕ, notes: '' },
    { id: 'star', emoji: '⭐', name: 'Звёздочка', subtitle: 'Старшая группа',
      c1: '#A78BFA', c2: '#6D28D9',
      children: ['Настя Крылова', 'Матвей Гусев', 'Юля Белова', 'Саша Титов', 'Рома Жуков'],
      schedule: РАСПИСАНИЕ, notes: '' },
    { id: 'rainbow', emoji: '🌈', name: 'Радуга', subtitle: 'Подготовительная группа',
      c1: '#FB7185', c2: '#BE185D',
      children: ['Ксюша Павлова', 'Илья Дроздов', 'Вика Ершова', 'Глеб Соловьёв'],
      schedule: РАСПИСАНИЕ, notes: '' },
    { id: 'bee', emoji: '🐝', name: 'Пчёлка', subtitle: 'Логопедическая группа',
      c1: '#FCD34D', c2: '#B45309',
      children: ['Никита Лапин', 'Алиса Юдина', 'Сева Богданов'],
      schedule: РАСПИСАНИЕ, notes: '' }
  ]
};

/* Заполнение базы при первом запуске */
(function заполнитьБазу() {
  const строка = база.prepare('SELECT id FROM state WHERE id = 1').get();
  if (!строка) {
    база.prepare('INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?)')
      .run(JSON.stringify(НАЧАЛЬНОЕ_СОСТОЯНИЕ), new Date().toISOString());
    console.log('✓ База данных инициализирована начальными данными');
  }
})();

/* ============================================================
   ПРОМЕЖУТОЧНЫЕ ОБРАБОТЧИКИ
   ============================================================ */
приложение.use(express.json({ limit: '2mb' }));
приложение.use(express.static(path.join(__dirname, 'public')));

/* Проверка токена администратора */
function требуется_вход(запрос, ответ, далее) {
  const заголовок = запрос.headers.authorization || '';
  const токен = заголовок.startsWith('Bearer ') ? заголовок.slice(7) : null;
  if (!токен) {
    return ответ.status(401).json({ error: 'Требуется авторизация' });
  }
  const строка = база.prepare('SELECT token FROM sessions WHERE token = ?').get(токен);
  if (!строка) {
    return ответ.status(401).json({ error: 'Сессия истекла' });
  }
  запрос.токен = токен;
  далее();
}

/* ============================================================
   ПРОГРАММНЫЙ ИНТЕРФЕЙС — ВХОД И ВЫХОД
   ============================================================ */
приложение.post('/api/login', (запрос, ответ) => {
  const { password } = запрос.body || {};
  const хэш = crypto.createHash('sha256')
    .update(String(password || ''))
    .digest('hex');

  if (хэш !== ХЭШ_ПАРОЛЯ) {
    return ответ.status(401).json({ error: 'Неверный пароль' });
  }
  const токен = crypto.randomBytes(32).toString('hex');
  база.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)')
    .run(токен, new Date().toISOString());
  ответ.json({ token: токен });
});

приложение.post('/api/logout', требуется_вход, (запрос, ответ) => {
  база.prepare('DELETE FROM sessions WHERE token = ?').run(запрос.токен);
  ответ.json({ ok: true });
});

/* ============================================================
   ПРОГРАММНЫЙ ИНТЕРФЕЙС — СОСТОЯНИЕ САЙТА
   ============================================================ */
приложение.get('/api/state', (запрос, ответ) => {
  const строка = база.prepare('SELECT json FROM state WHERE id = 1').get();
  ответ.json(строка ? JSON.parse(строка.json) : НАЧАЛЬНОЕ_СОСТОЯНИЕ);
});

приложение.post('/api/state', требуется_вход, (запрос, ответ) => {
  const новое = запрос.body;
  if (!новое || typeof новое !== 'object' || !Array.isArray(новое.groups)) {
    return ответ.status(400).json({ error: 'Некорректные данные' });
  }
  база.prepare(`
    INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      json = excluded.json,
      updated_at = excluded.updated_at
  `).run(JSON.stringify(новое), new Date().toISOString());
  ответ.json({ ok: true });
});

/* ============================================================
   ЗАПУСК СЕРВЕРА
   ============================================================ */
приложение.listen(ПОРТ, () => {
  console.log('');
  console.log('  ✓ Сервер запущен');
  console.log('  ✓ Адрес:  http://localhost:' + ПОРТ);
  console.log('  ✓ Пароль администратора: ' + ПАРОЛЬ_АДМИНА);
  console.log('  ✓ База данных: ' + path.join(__dirname, 'data.db'));
  console.log('');
});