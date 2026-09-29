import type { Dictionary } from "./i18n";

/** Russian. Plural forms: one (1, 21), few (2–4), many (0, 5–20), other (fractions). */
export const ru: Dictionary = {
  "app.title": "{title} · Konspecter",
  "app.storageFailed": "Konspecter не удалось открыть локальное хранилище",
  "app.skipToContent": "Перейти к содержимому",
  "app.updateAvailable": "Доступна новая версия Konspecter.",
  "app.reload": "Обновить",
  "app.later": "Позже",
  "app.tryAgain": "Повторить",
  "app.close": "Закрыть",
  "app.cancel": "Отмена",

  "sidebar.label": "Боковая панель",
  "sidebar.show": "Показать боковую панель",
  "sidebar.hide": "Скрыть боковую панель",
  "sidebar.settings": "Настройки",
  "sidebar.newNote": "Новая заметка",
  "sidebar.tags": "Конспекты",
  "sidebar.tagsHint": "Напишите в заметке {tag} или {nested}.",
  "sidebar.recent": "Недавние",
  "sidebar.noNotes": "Заметок пока нет.",
  "tree.expand": "Развернуть #{tag}",
  "tree.collapse": "Свернуть #{tag}",
  "tree.notes": {
    one: "{count} заметка",
    few: "{count} заметки",
    many: "{count} заметок",
    other: "{count} заметки",
  },

  "topbar.search": "Поиск по заметкам",
  "topbar.searchPlaceholder": "Поиск",
  "topbar.darkTheme": "Тёмная тема",
  "topbar.toLight": "Включить светлую тему",
  "topbar.toDark": "Включить тёмную тему",
  "topbar.markdown": "Markdown",
  "topbar.toText": "Перейти в текстовый редактор",
  "topbar.toMarkdown": "Перейти к исходному Markdown",
  "antenna.idle": "Всё сохранено на этом устройстве",
  "antenna.active": "Сохранение и синхронизация",
  "antenna.offline": "Нет связи: заметки сохраняются на этом устройстве и синхронизируются позже",
  "syncHint.offline": "Нет связи",
  "syncHint.failed": "Ошибка синхронизации",
  "syncHint.blocked": {
    one: "{count} не синхронизирована",
    few: "{count} не синхронизированы",
    many: "{count} не синхронизировано",
    other: "{count} не синхронизировано",
  },
  "syncHint.label": "Синхронизация: {text}",

  "shortcut.search": "Поиск",
  "shortcut.newNote": "Новая заметка",
  "shortcut.settings": "Настройки",
  "shortcut.save": "Сохранить сейчас (заметки сохраняются и при наборе)",
  "shortcut.sidebar": "Показать или скрыть боковую панель",
  "shortcut.editorMode": "Переключить текстовый редактор и Markdown",
  "shortcut.help": "Показать эти сочетания клавиш",
  "shortcuts.title": "Сочетания клавиш",

  "note.untitled": "Без названия",
  "note.unreadable": "Нечитаемая заметка",
  "note.new": "Новая заметка",
  "note.loadFailed": "Не удалось загрузить заметку",
  "note.notFound": "Заметка не найдена",
  "note.notFoundText": "Такой заметки нет или она удалена.",
  "note.backToNotes": "К заметкам",
  "note.pageNotFound": "Страница не найдена",
  "note.conflictCopy":
    "Это копия конфликта: в ней версия, изменённая в двух местах одновременно. Сравните её с {original}, оставьте нужное, затем удалите эту копию.",
  "note.theOriginal": "оригиналом",
  "note.changedElsewhere":
    "Пока вы редактировали, заметку изменили в другом месте. Ваша версия сохранена как копия конфликта, а другая осталась в этой заметке.",
  "note.resumeAt": "Вы прочитали {percent}% этой заметки.",
  "note.continueReading": "Продолжить чтение",
  "note.startFromTop": "Начать сначала",
  "note.notSavedInvalid":
    "Не сохранено: {reason}. Исправьте frontmatter, и сохранение продолжится.",
  "note.saveFailed":
    "Не удалось сохранить заметку: {error}. Текст не потерян; при следующем изменении будет новая попытка.",

  "details.title": "Сведения",
  "details.status": "Состояние",
  "details.notSaved": "Ещё не сохранена",
  "details.created": "Создана",
  "details.edited": "Изменена",
  "details.length": "Объём",
  "details.empty": "Пусто",
  "details.words": {
    one: "{count} слово",
    few: "{count} слова",
    many: "{count} слов",
    other: "{count} слова",
  },
  "details.characters": {
    one: "{count} символ",
    few: "{count} символа",
    many: "{count} символов",
    other: "{count} символа",
  },
  "details.readingTime": "{minutes} мин чтения",
  "details.tags": "Теги",
  "details.cover": "Обложка",
  "details.frontmatter": "Frontmatter",
  "details.unreadable": "Не читается",
  "details.file": "Файл",
  "details.actions": "Действия с заметкой",
  "details.titleAndCover": "Заголовок и обложка",
  "details.export": "Экспорт…",
  "details.download": "Скачать .md",
  "details.openExternally": "Открыть во внешнем редакторе",
  "details.reveal": "Показать в Finder",
  "details.delete": "Удалить",
  "details.deleteTitle": "Удалить заметку?",
  "details.confirmDelete": "Заметка «{title}» будет удалена. Это нельзя отменить.",
  "details.confirmDeleteFile": "Заметка «{title}» будет перемещена в корзину системы.",
  "details.deleteFailed": "Не удалось удалить заметку: {error}",

  "list.notes": "Заметки",
  "list.searchResults": "Результаты поиска",
  "list.loadFailed": "Не удалось загрузить заметки",
  "list.searchFailed": "Поиск не удался",
  "list.noMatches": "Подходящих заметок нет",
  "list.tagFilters": "Фильтры по тегам",
  "list.removeTag": "Убрать фильтр #{tag}",
  "list.unreadable":
    "Некоторые сохранённые заметки не удалось прочитать. Они сохранены; см. {link}.",
  "list.unreadableLink": "Настройки → Резервные копии и восстановление",
  "welcome.title": "Добро пожаловать в Konspecter",
  "welcome.text":
    "Технические заметки в обычном Markdown: хранятся на этом устройстве и работают без сети. Отмечайте их {tags} где угодно, находите полнотекстовым поиском и синхронизируйте с сервером, когда захотите.",
  "welcome.create": "Создать первую заметку",
  "welcome.example": "Добавить пример заметки",
  "welcome.import":
    "Уже есть заметки? Импортируйте файлы {md} или папку в {settings}, там же подключается синхронизация.",
  "welcome.exampleNote": `# Добро пожаловать в Konspecter

Каждая заметка — это документ **Markdown**. Эта показывает, что это даёт.

## Заголовки и списки

- Простые списки и нумерованные
- Ссылки: [CommonMark](https://commonmark.org)

## Код

\`\`\`java
Map<String, Integer> counts = new HashMap<>();
\`\`\`

## Теги

Пишите тег где угодно, например #konspecter или вложенный: #konspecter#начало_работы.
Они видны на боковой панели, и поиск их понимает: попробуйте \`#konspecter\`.

Всё, что вы пишете, сохраняется сразу. Переключитесь на **Markdown** вверху, чтобы увидеть
исходный текст, или удалите эту заметку, когда закончите.
`,

  "editor.loadFailed": "Не удалось загрузить редактор",
  "editor.readerLoadFailed": "Не удалось загрузить просмотр заметки",
  "editor.textUnavailable":
    "Текстовое редактирование недоступно: {reason}. Исправьте это в Markdown ниже.",
  "editor.markdownOnly": "{reason}, поэтому её можно редактировать только в режиме Markdown.",
  "editor.uses": "В этой заметке есть {features}",
  "editor.wouldChange": "В этой заметке есть Markdown, который текстовый редактор изменил бы",
  "editor.feature.tables": "таблицы",
  "editor.feature.strikethrough": "зачёркивание",
  "editor.feature.html": "HTML",
  "editor.feature.taskLists": "списки задач",
  "editor.feature.footnotes": "сноски",
  "editor.text": "Текст заметки",
  "editor.source": "Markdown",
  "editor.placeholder": "Начните писать…",
  "editor.sourcePlaceholder": "# Заголовок",
  "editor.title": "Заголовок",
  "editor.cover": "Обложка",
  "editor.formatting": "Форматирование",
  "editor.found": "Заголовок и теги, найденные в тексте",
  "editor.found.title": "Заголовок",
  "editor.found.tags": "Теги",
  "editor.allTools": "Все инструменты форматирования",
  "editor.showTools": "Показать все инструменты форматирования",
  "editor.foldTools": "Свернуть панель",
  "editor.linkAddress": "Адрес ссылки",
  "tool.bold": "Жирный",
  "tool.italic": "Курсив",
  "tool.code": "Код в строке",
  "tool.heading": "Заголовок",
  "tool.subheading": "Подзаголовок",
  "tool.quote": "Цитата",
  "tool.bulletList": "Маркированный список",
  "tool.orderedList": "Нумерованный список",
  "tool.codeBlock": "Блок кода",
  "tool.link": "Ссылка",

  "settings.title": "Настройки",
  "settings.theme": "Тема",
  "settings.theme.system": "Как в системе",
  "settings.theme.light": "Светлая",
  "settings.theme.dark": "Тёмная",
  "settings.editor": "Редактор по умолчанию",
  "settings.editor.hint":
    "Заметки, которые текстовый редактор не может показать, всегда открываются в Markdown.",
  "settings.editor.text": "Текст",
  "settings.editor.markdown": "Markdown",
  "settings.editingArea": "Область редактирования",
  "settings.editingArea.hint":
    "Чуть более тёмная панель с полями по бокам показывает, где редактируется заметка.",
  "settings.editingArea.highlighted": "Выделена",
  "settings.editingArea.plain": "Без выделения",
  "settings.textSize": "Размер текста",
  "settings.textSize.small": "Мелкий",
  "settings.textSize.default": "Обычный",
  "settings.textSize.large": "Крупный",
  "settings.textSize.larger": "Очень крупный",
  "settings.tagNames": "Названия тегов",
  "settings.tagNames.hint": "Как теги называются на боковой панели.",
  "settings.tagNames.capitalized": "С заглавной буквы",
  "settings.tagNames.asWritten": "Как написано в заметках",
  "settings.reading": "Место чтения",
  "settings.reading.restore": "Продолжать с того места, где остановился",
  "settings.reading.ask": "Спрашивать перед переходом",
  "settings.reading.off": "Всегда начинать сначала",
  "settings.saveFailed": "Не удалось сохранить настройки: {error}. Они действуют до перезагрузки.",
  "settings.shortcuts": "Сочетания клавиш",
  "settings.storage": "Хранение без сети",
  "settings.storage.persistent": "Заметки надёжно хранятся на этом устройстве и работают без сети.",
  "settings.storage.bestEffort":
    "Заметки работают без сети, но браузер может удалить их, если на устройстве кончится место.",
  "settings.storage.unsupported":
    "Этот браузер не сообщает, может ли он удалить сохранённые заметки.",
  "settings.storage.keep": "Хранить заметки на этом устройстве",
  "settings.about": "О программе",
  "settings.about.text":
    "{name} {version} для {os}. Заметки хранятся в локальной базе данных приложения.",
  "settings.about.unavailable": "Сведения о приложении недоступны.",
  "settings.library": "Библиотека",
  "settings.library.app":
    "Заметки хранятся в собственной библиотеке приложения, которая может синхронизироваться с сервером. Вместо этого можно работать прямо с папкой файлов {md}.",
  "settings.library.open": "Открыть папку Markdown…",
  "settings.library.folder":
    "Работа с файлами Markdown в папке {folder}. Изменения сохраняются в файлы; удалённые заметки попадают в корзину системы.",
  "settings.library.folderSync":
    "Синхронизация относится к библиотеке приложения и продолжается в фоне. Чтобы эта папка была на других устройствах, синхронизируйте её через Git, iCloud Drive, Dropbox или Syncthing: Konspecter следит за их изменениями, а правки, сделанные в двух местах одновременно, сохраняются как копии конфликта.",
  "settings.library.nothingToImport": "Импортировать нечего: эти заметки уже есть в библиотеке.",
  "settings.library.imported": {
    one: "В библиотеку приложения импортирована {count} заметка.",
    few: "В библиотеку приложения импортированы {count} заметки.",
    many: "В библиотеку приложения импортировано {count} заметок.",
    other: "В библиотеку приложения импортировано {count} заметки.",
  },
  "settings.library.import": "Импортировать в библиотеку приложения",
  "settings.library.useApp": "Использовать библиотеку приложения",

  "backup.title": "Резервные копии и восстановление",
  "backup.hint":
    "Для резервной копии экспортируйте все заметки: это обычные файлы Markdown, им больше ничего не нужно. Индексы тегов и поиска строятся из заметок и всегда могут быть перестроены.",
  "backup.rebuild": "Перестроить индексы",
  "backup.rebuilt": {
    one: "Индексы перестроены по {count} заметке.",
    few: "Индексы перестроены по {count} заметкам.",
    many: "Индексы перестроены по {count} заметкам.",
    other: "Индексы перестроены по {count} заметки.",
  },
  "backup.unreadable": {
    one: "{count} сохранённую запись не удалось прочитать как заметку. Она оставлена как есть. Скачайте её, чтобы изучить или восстановить вручную, затем удалите.",
    few: "{count} сохранённые записи не удалось прочитать как заметки. Они оставлены как есть. Скачайте их, чтобы изучить или восстановить вручную, затем удалите.",
    many: "{count} сохранённых записей не удалось прочитать как заметки. Они оставлены как есть. Скачайте их, чтобы изучить или восстановить вручную, затем удалите.",
    other:
      "{count} сохранённой записи не удалось прочитать как заметки. Они оставлены как есть. Скачайте их, чтобы изучить или восстановить вручную, затем удалите.",
  },
  "backup.download": "Скачать их (.json)",
  "backup.remove": "Удалить их",
  "backup.downloadFirst": "Сначала скачайте их",
  "backup.removed": "Нечитаемые записи удалены.",

  "transfer.title": "Импорт и экспорт",
  "transfer.hint":
    "Заметки — это обычный Markdown: импорт сохраняет файлы как есть, а экспорт даёт те же файлы {md}, которые читаются и без Konspecter.",
  "transfer.importFiles": "Импортировать файлы .md…",
  "transfer.importFolder": "Импортировать папку…",
  "transfer.exportFolder": "Экспортировать всё в папку…",
  "transfer.exportZip": "Экспортировать всё (.zip)",
  "transfer.imported": {
    one: "Импортирована {count} заметка",
    few: "Импортированы {count} заметки",
    many: "Импортировано {count} заметок",
    other: "Импортировано {count} заметки",
  },
  "transfer.duplicates": {
    one: "{count} уже есть в библиотеке",
    few: "{count} уже есть в библиотеке",
    many: "{count} уже есть в библиотеке",
    other: "{count} уже есть в библиотеке",
  },
  "transfer.rejected": {
    one: "{count} не импортирована",
    few: "{count} не импортированы",
    many: "{count} не импортировано",
    other: "{count} не импортировано",
  },
  "transfer.nothing": "Экспортировать нечего: заметок нет.",
  "transfer.exportedTo": {
    one: "{count} заметка экспортирована в {folder}.",
    few: "{count} заметки экспортированы в {folder}.",
    many: "{count} заметок экспортировано в {folder}.",
    other: "{count} заметки экспортировано в {folder}.",
  },
  "transfer.exportedZip": {
    one: "{count} заметка экспортирована в {file}.",
    few: "{count} заметки экспортированы в {file}.",
    many: "{count} заметок экспортировано в {file}.",
    other: "{count} заметки экспортировано в {file}.",
  },

  "sync.title": "Синхронизация",
  "sync.state.disabled": "Не подключено",
  "sync.state.idle": "Всё синхронизировано",
  "sync.state.syncing": "Синхронизация…",
  "sync.state.offline": "Нет связи — изменения сохранены и будут отправлены, когда связь появится",
  "sync.state.error": "Ошибка синхронизации; повторяем",
  "sync.pending": {
    one: "{count} ждёт отправки",
    few: "{count} ждут отправки",
    many: "{count} ждут отправки",
    other: "{count} ждут отправки",
  },
  "sync.blocked": {
    one: "{count} задержана",
    few: "{count} задержаны",
    many: "{count} задержано",
    other: "{count} задержано",
  },
  "sync.connectedTo": "Подключено к {server} как {account}.",
  "sync.lastSynced": "последняя синхронизация {date}",
  "sync.heldBack":
    "Заметки, изменённые на двух устройствах одновременно, задержаны; обе версии сохранены.",
  "sync.now": "Синхронизировать",
  "sync.disconnect": "Отключиться",
  "sync.intro":
    "Заметки в любом случае остаются на этом устройстве. Подключение синхронизирует их с сервером Konspecter.",
  "sync.serverUrl": "Адрес сервера",
  "sync.token": "Токен доступа",
  "sync.connectFailed": "Не удалось подключиться: {error}",
  "sync.connect": "Подключиться",
};
