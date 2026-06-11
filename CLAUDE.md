# CLAUDE.md — контекст проекта GeoJSON Zones

Этот файл читается в начале каждой сессии. Здесь — то, что не выводится из кода:
назначение, решения, договорённости. Обновляй его при изменении архитектуры.

## Назначение

Десктоп-приложение (Windows, .exe) для хранения и систематизации **зон** —
полигонов GeoJSON, очерченных в агломерации города. Зоны нужны сервису расчёта
стоимости перевозки и проверки входимости адреса клиента в зону. Группируются
по **городам**.

Изначально проект был одностраничным HTML-конвертером GeoJSON→XLSX
(`geojson to xlxs2.html`). Из него переносится проверенная логика разбора GeoJSON.

## Принятые решения

- **Стек:** Electron + electron-builder (NSIS .exe). SQLite (`better-sqlite3`) —
  хранилище. SheetJS (`xlsx`) — Excel. Leaflet + OSM — карта (нужен интернет для тайлов).
- **Хранилище = источник истины:** в БД хранится **исходный GeoJSON целиком**.
  XLSX и точки генерируются по запросу. БД лежит в `app.getPath('userData')/zones.db`.
- **Имя ≠ содержимое:** переименование города/зоны меняет только поле `name` в БД,
  не трогая `geojson`, `source_filename` и даты содержимого.
- **Зона может быть без города:** `zones.city_id` NULLABLE. Логика работы —
  «сначала загружают зону(-ы) (drag&drop), потом назначают город». Зоны без города
  подсвечиваются и помечаются бейджем «не выбран город».
- **Удаление города** → зоны **открепляются** (`ON DELETE SET NULL`), не удаляются.
- **Современный UI:** боковая навигация, карточки, модалки вместо alert, тосты,
  drag&drop. Чистый CSS, без тяжёлых фреймворков.

## Структура

```
electron/main.js      — главный процесс: окно, IPC, экспорт-диалоги
electron/preload.js   — contextBridge → window.api
electron/db.js        — SQLite, единственное место с SQL (репозиторий)
electron/xlsx-export.js — GeoJSON → XLSX-буфер (main, npm-пакет xlsx)
electron/menu.js      — верхнее меню приложения (Файл/Вид/Помощь, рус.)
electron/export-folders.js — writeAllToFolders / writeZonesToFolder / sanitizeName (чистые)
electron/selftest.js  — отладочные/тестовые хуки, активны только при GZ_* env
shared/geojson.js     — extractLonLat (UMD: require в main + window.GeoJSONLib в renderer)
src/index.html        — каркас (боковая навигация + области модалок/тостов)
src/styles.css        — стили + токены темы (CSS-переменные)
src/app.js            — ядро renderer: роутинг, модалки, тосты, formatDate, el()
src/boot.js           — init на DOMContentLoaded (отдельный файл — не ослабляем CSP)
src/views/catalog.js  — справочник городов
src/views/zones.js    — журнал город→зоны, drag&drop, секция «без города»
src/views/map.js      — Leaflet-карта
src/views/log.js      — журнал действий
src/vendor/leaflet/   — локальная копия Leaflet (js/css/images, без CDN)
```

Renderer без сборщика: <script> подключаются по порядку (leaflet → shared/geojson
→ app → views → boot). Вкладка регистрируется через `App.registerView(name,{show})`.

Тесты: `npm run test:db`, `test:geojson`, `test:folders` (чистый node), `test:ui`,
`test:func`, `test:badge`, `test:map` (через Electron в изолированной временной БД, env GZ_*).
`test:badge` — регрессия на скрытие счётчика «без города» при нуле зон.
`test:map` — мульти-показ зон города на карте и «Очистить отображение».

**Принцип:** UI ходит к данным только через `window.api`. SQL — только в `db.js`.
Новая фича = метод в `db.js` + вызов в `api` + правка одной вкладки. Остальное не трогаем.

## Модель данных (SQLite)

- `cities(id, name UNIQUE, created_at)`
- `zones(id, city_id→cities ON DELETE SET NULL, name, geojson, point_count,
  source_filename, created_at, geojson_updated_at, xlsx_generated_at)`
- `action_log(id, ts, level, message)`

Даты: `cities.created_at`; `zones.created_at` (создание), `geojson_updated_at`
(изменение GeoJSON), `xlsx_generated_at` (последняя генерация XLSX, NULL = «—»).

## window.api (IPC)

- `cities.list / create(name) / rename(id,name) / delete(id)` (delete открепляет зоны)
- `zones.listByCity(cityId) / listUnassigned() / countUnassigned() / get(id)`
- `zones.create({name, geojson, cityId?, pointCount?, sourceFilename?})` — без cityId «без города»
- `zones.rename(id,name) / assignCity(id, cityId) / move(id, newCityId) / delete(id)`
- `zones.assignCityBulk(ids, cityId|null) / deleteBulk(ids)` — массовые операции
- `zones.exportGeojson(id) / exportXlsx(id)` (exportXlsx обновляет xlsx_generated_at)
- `zones.exportManyToFolder(ids, "geojson"|"xlsx")` — массовое скачивание в папку
- `log.list(limit) / append(level,message) / clear()`
- `api.on(channel, cb)` — события main→renderer, белый список: `menu:help`, `data:changed`

Резервная копия и экспорт в папки выполняются из ВЕРХНЕГО меню (main-процесс,
функции `exportBackup/importBackup/exportAllToFolders` в main.js), не через api.

## v0.2.0 (что добавлено)

- **Верхнее меню (electron/menu.js):** Файл (Экспортировать все данные в папки;
  Сохранить/Загрузить резервную копию; Выход), Вид (Обновить, DevTools, масштаб),
  Помощь (О программе → событие `menu:help` → модалка `App.showHelp()`).
- **Резервная копия:** один JSON `{ app:"geojson-zones", version:2, cities[], zones[] }`,
  город хранится по ИМЕНИ. Импорт — режим **merge** (`db.data.importAll`): города по
  имени переиспользуются, зоны добавляются. После импорта main шлёт `data:changed`.
- **Экспорт в папки:** `<root>/<Город>/<Город>_geojson|_xlsx/<Зона>.*`, плюс «Без города».
  sanitizeName сохраняет пробелы/дефисы, коллизии имён → ` (2)`.
- **Левое меню:** порядок Зоны→Города, старт-вкладка «Зоны», бейдж `#zonesBadge`
  со счётчиком зон без города (`App.refreshUnassignedBadge`).
- **Вкладка Зоны:** поиск по названию, множественный выбор (чекбоксы + панель массовых
  действий), нумерация в пределах группы, поясняющая надпись при загрузке не-geojson/json.
- **Вкладка Карта:** поиск зоны фильтрует выпадающий список. **Города:** нумерация.

## v0.3.0 (что добавлено)

- **Иконки:** `App.icon(name)` в `src/app.js` — inline-SVG (download/map/pencil/trash/eye/
  chevron), без сети, CSP-safe. Используется на кнопках во всех вкладках.
- **Вкладка Зоны:** города `<details>` **свёрнуты по умолчанию**; кнопки «Раскрыть все»/
  «Свернуть все» (`toggleAll`); при поиске города с совпадениями авто-раскрываются.
  Кнопка **«Редактировать»** (карандаш) вместо «⋯» → модалка `editZone` (имя + город),
  инлайн-селект города из строки убран.
- **Вкладка Города:** карточка → раскрываемый `<details>.city-node` (свёрнут по умолчанию);
  при первом раскрытии **лениво** грузится список зон (`loadCityZones`) с кнопками
  «На карте»/«GeoJSON»/«XLSX»; кнопки города в `summary` (stopPropagation). «Раскрыть/Свернуть все».
- **Вкладка Карта (переписана):** выбор города → **видимый чек-лист зон** (поиск фильтрует
  его — старый баг скрытого `<select>` устранён); `loadZones(ids)` рисует НЕСКОЛЬКО слоёв
  (`layers[]`, всегда один город by design); «Все зоны города»; **лоадер** `.map-loading`
  (`.map-loading[hidden]{display:none}` — иначе display перебивает hidden); «Очистить
  отображение» (`clearLayers`).
- Регресс-тесты: `test:map` (GZ_MAPTEST), `test:badge` (GZ_BADGETEST).

## Имя приложения и папка данных (v0.4.0)

- Отображаемое имя — **polygons** (window title, бренд в сайдбаре, `<title>`,
  `build.productName`). `appId` прежний (`com.nikitgolubev.geojsonzones`).
- **userData закреплён** на прежней папке: в `main.js` до `db.init` стоит
  `app.setPath("userData", path.join(app.getPath("appData"), "GeoJSON Zones"))`.
  Иначе смена productName увела бы БД в `%APPDATA%/polygons` и «потеряла» данные.

## Темы и оформление (v0.4.0)

- **Светлая/тёмная тема:** базовые токены в `:root`, тёмная — переопределение
  `:root[data-theme="dark"]{...}` в `src/styles.css` (+ точечные правки захардкоженных
  светлых поверхностей). Атрибут ставит `document.documentElement.dataset.theme`.
- Управление темой в `src/app.js`: `getTheme/applyTheme/setTheme/toggleTheme`, хранится в
  `localStorage["theme"]`, применяется в `init()` до первой отрисовки. Переключатель —
  кнопка `#themeToggle` у версии в сайдбаре; пункт меню «Вид → Тема» шлёт `menu:set-theme`.
- **Цвет кнопок:** класс `btn-map` (оранжевая, «На карте»), `btn-xlsx` (зелёная, «XLSX»);
  токены `--btn-map*/--btn-xlsx*`. Работают в обеих темах.

## Среда разработки (важные нюансы)

- **Node:** ставится через nvm — `v24.16.0`. Активировать:
  `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`.
- **Python для node-gyp:** системный Python 3.14 убрал `distutils` и ломает сборку
  `better-sqlite3`. В проектном `.npmrc` прописан `python=/usr/bin/python3`
  (Apple Python 3.9 с distutils). npm выдаёт безобидный warning «Unknown config python».
- **ELECTRON_RUN_AS_NODE:** VSCode (сам на Electron) выставляет эту переменную в
  интегрированном терминале. Из-за неё `electron .` стартует как обычный Node и
  `require('electron')` не отдаёт API. Поэтому `npm start` идёт через
  `scripts/start.js`, который сбрасывает переменную для дочернего процесса. Не убирать.
- Если после `npm install` Electron жалуется «failed to install correctly»
  (нет `node_modules/electron/path.txt`) — распаковка бинаря прервалась; перезапустить
  `node node_modules/electron/install.js` или переустановить electron.

## Git / GitHub

- Remote: `git@github.com:Nikitgolubev/geojson-to-xlsx.git` (push по SSH; `gh` не установлен).
- После каждого этапа: `git add -A` → коммит → `git push origin main`.

## Сборка установщика (.exe)

- **Только на Windows.** `better-sqlite3` не кросс-компилируется под win32 с macOS:
  `npm run dist:win` на маке создаёт .exe, но native-модуль внутри — Mach-O (mac),
  и приложение падает на Windows. Проверено: `file better_sqlite3.node` → Mach-O.
- Боевая сборка идёт через GitHub Actions (`.github/workflows/build-win.yml`,
  runs-on: windows-latest). Workflow удаляет mac-специфичный `.npmrc` перед install.
- На Windows better-sqlite3 ставится prebuilt (компиляция не нужна), поэтому сборка
  быстрая и корректная. Шаг setup-python 3.11 оставлен как страховка на случай,
  если когда-нибудь понадобится компиляция native-модуля.
- Скрипты dist используют `--publish never`: иначе electron-builder при наличии тега
  пытается сам публиковать релиз и падает без `GH_TOKEN`. Публикацию .exe в Release
  делает отдельный шаг workflow (softprops/action-gh-release).
- Запуск: Actions → Build Windows installer → Run workflow; либо пуш тега `vX.Y.Z`
  (тогда .exe прикрепляется к Release).
- Иконка «карта с локатором»: исходник `build/icon.svg`, генерация `npm run make:icon`
  (`scripts/make-icon.js` рисует SVG→canvas→`build/icon.png` 256 и собирает `build/icon.ico`
  без внешних зависимостей). `build.win.icon = build/icon.ico`. Файлы закоммичены.

## Будущее: macOS (сейчас НЕ собираем)

Код пишем кроссплатформенно, чтобы добавить mac-сборку без переделок:
- Пути только через `app.getPath` / `path.join`, без захардкоженных `C:\...`.
- Структура `build` в `package.json` готова к секции `mac` (dmg) и скрипту `dist:mac`.
- `better-sqlite3` пересобирается под каждую ОС — mac-сборку делать на macOS.
- Системный шрифт-стек, без win-only API в главном процессе.

## Переиспользуемый код (референс)

- `extractLonLat` и хелперы — перенесены в `shared/geojson.js` (UMD).
- Генерация XLSX — `electron/xlsx-export.js` (`geojsonToXlsxBuffer`).
- CSS-база была из `geojson to xlxs2.html`, развита в `src/styles.css`.

## Открытые вопросы

- Порядок столбцов XLSX: сейчас `longitude, latitude`. Уточнить при Этапе 2
  (пользователь упоминал «широта и долгота»).
