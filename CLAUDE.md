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
electron/main.js      — главный процесс: окно, IPC, ФС
electron/preload.js   — contextBridge → window.api
electron/db.js        — SQLite, единственное место с SQL (репозиторий)
src/index.html        — каркас вкладок
src/styles.css        — стили (база из geojson to xlxs2.html)
shared/geojson.js     — extractLonLat (UMD: require в main + window.GeoJSONLib в renderer)
electron/xlsx-export.js — GeoJSON → XLSX-буфер (main, использует npm-пакет xlsx)
src/views/catalog.js  — справочник городов
src/views/zones.js    — журнал город→зоны, drag&drop, секция «без города»
src/views/map.js      — Leaflet-карта
src/views/log.js      — журнал действий
src/vendor/           — локальные xlsx, leaflet (без CDN)
```

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
- `zones.listByCity(cityId) / listUnassigned() / get(id)`
- `zones.create(name, geojson, cityId?)` — без cityId зона «без города»
- `zones.rename(id,name) / assignCity(id, cityId) / move(id, newCityId) / delete(id)`
- `zones.importFiles(fileList, cityId?)` — массовая загрузка/drag&drop
- `zones.exportGeojson(id) / exportXlsx(id)` (exportXlsx обновляет xlsx_generated_at)
- `log.list(limit) / append(level,message) / clear()`

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

## Будущее: macOS (сейчас НЕ собираем)

Код пишем кроссплатформенно, чтобы добавить mac-сборку без переделок:
- Пути только через `app.getPath` / `path.join`, без захардкоженных `C:\...`.
- Структура `build` в `package.json` готова к секции `mac` (dmg) и скрипту `dist:mac`.
- `better-sqlite3` пересобирается под каждую ОС — mac-сборку делать на macOS.
- Системный шрифт-стек, без win-only API в главном процессе.

## Переиспользуемый код (референс)

- `extractLonLat` и хелперы — `geojson to xlxs2.html:213-380` → `src/geojson.js`.
- Генерация XLSX — `geojson to xlxs2.html:411-432` → `src/xlsx-export.js`.
- CSS-база — `geojson to xlxs2.html:8-125`.

## Открытые вопросы

- Порядок столбцов XLSX: сейчас `longitude, latitude`. Уточнить при Этапе 2
  (пользователь упоминал «широта и долгота»).
