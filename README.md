# iDK Launcher

Быстрый и удобный Minecraft лаунчер на Electron.

## Возможности

- Запуск любых версий Minecraft (vanilla, snapshot, legacy)
- Установка модлоадеров (Fabric, Quilt, Forge, NeoForge, LiteLoader)
- Каталог модов, ресурспаков и шейдеров с Modrinth (с пагинацией)
- Модпаки (mrpack) с Modrinth: поиск, установка и создание своих
- Аккаунты: offline, ely.by, Microsoft
- Скины и плащи (ely.by / локальные)
- Автоопределение и автозагрузка Java (Adoptium)
- Новости из Telegram-канала
- 4 темы оформления (тёмная, OLED, светлая «Aurora», белая «Ice») и выбор акцентного цвета
- 8 языков: English, Русский, Deutsch, Français, Español, Italiano, Polski, Українська

## Разработка

```bash
npm install
npm start
```

Проверка перед сборкой: `npm run smoke`.

## Сборка

```bash
npm run dist:win     # Windows (NSIS)
npm run dist:linux   # Linux (AppImage)
npm run dist:mac     # macOS (dmg)
```

Готовый установщик появится в `dist/`.

## Данные

Файлы игры хранятся в `%APPDATA%\.idk-launcher\minecraft`, настройки — в `%APPDATA%\idk-launcher\settings.json`.

## Лицензия

MIT — см. [LICENSE](LICENSE).
