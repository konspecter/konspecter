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
  "app.somethingWrong": "Упс, что-то пошло не так.",

  "sidebar.label": "Боковая панель",
  "sidebar.show": "Показать боковую панель",
  "sidebar.hide": "Скрыть боковую панель",
  "sidebar.settings": "Настройки",
  "sidebar.allNotes": "Все конспекты",
  "sidebar.newNote": "Новый конспект",
  "sidebar.tags": "Теги",
  "sidebar.tagsHint": "Напишите в конспекте {tag} или {nested}.",
  "sidebar.recent": "Недавние",
  "sidebar.noNotes": "Конспектов пока нет.",
  "tree.expand": "Развернуть #{tag}",
  "tree.collapse": "Свернуть #{tag}",
  "tree.notes": {
    one: "{count} конспект",
    few: "{count} конспекта",
    many: "{count} конспектов",
    other: "{count} конспекта",
  },

  "topbar.search": "Поиск по конспектам",
  "topbar.searchPlaceholder": "Поиск",
  "topbar.find": "Поиск в этом конспекте",
  "topbar.findPlaceholder": "Поиск в конспекте",
  "topbar.findCount": "Совпадение {current} из {count}",
  "topbar.findPrevious": "Предыдущее совпадение",
  "topbar.findNext": "Следующее совпадение",
  "topbar.closeSearch": "Закрыть поиск",
  "topbar.back": "Назад",
  "topbar.forward": "Вперёд",
  "topbar.actions": "Основные действия",
  "topbar.darkTheme": "Тёмная тема",
  "topbar.toLight": "Включить светлую тему",
  "topbar.toDark": "Включить тёмную тему",
  "topbar.markdown": "Markdown",
  "topbar.toText": "Перейти в текстовый редактор",
  "topbar.toMarkdown": "Перейти к исходному Markdown",
  "antenna.idle": "Всё сохранено на этом устройстве",
  "antenna.active": "Сохранение и синхронизация",
  "antenna.offline": "Нет связи: конспекты сохраняются на этом устройстве и синхронизируются позже",
  "syncHint.failed": "Ошибка синхронизации",
  "syncHint.disconnected": "Синхронизация остановлена",
  "syncHint.locked": "Синхронизация заблокирована",
  "syncHint.unpaid": "Синхронизация приостановлена",
  "syncHint.blocked": {
    one: "{count} не синхронизирована",
    few: "{count} не синхронизированы",
    many: "{count} не синхронизировано",
    other: "{count} не синхронизировано",
  },
  "syncHint.label": "Синхронизация: {text}",

  "shortcut.search": "Поиск",
  "shortcut.find": "Поиск в открытом конспекте",
  "shortcut.allNotes": "Все конспекты",
  "shortcut.newNote": "Новый конспект",
  "shortcut.settings": "Настройки",
  "shortcut.save": "Сохранить сейчас (конспекты сохраняются и при наборе)",
  "shortcut.sidebar": "Показать или скрыть боковую панель",
  "shortcut.editorMode": "Переключить текстовый редактор и Markdown",
  "shortcut.back": "Назад (вне текстовых полей)",
  "shortcut.forward": "Вперёд (вне текстовых полей)",
  "shortcut.help": "Показать эти сочетания клавиш",
  "shortcuts.title": "Сочетания клавиш",
  "shortcuts.or": "или",

  "note.untitled": "Без названия",
  "note.unreadable": "Нечитаемый конспект",
  "note.new": "Новый конспект",
  "note.loadFailed": "Не удалось загрузить конспект",
  "note.notFound": "Конспект не найден",
  "note.notFoundText": "Такого конспекта нет или он удалён.",
  "note.backToNotes": "К конспектам",
  "note.pageNotFound": "Страница не найдена",
  "note.conflictCopy":
    "Это копия конфликта: в ней версия, изменённая в двух местах одновременно. Сравните её с {original}, оставьте нужное, затем удалите эту копию.",
  "note.theOriginal": "оригиналом",
  "note.deletedElsewhere":
    "Этот конспект удалили в другом месте. Если продолжить редактирование, он вернётся.",
  "note.resumeAt": "Вы прочитали {percent}% этого конспекта.",
  "note.continueReading": "Продолжить чтение",
  "note.startFromTop": "Начать сначала",
  "note.notSavedInvalid":
    "Не сохранено: {reason}. Исправьте frontmatter, и сохранение продолжится.",
  "note.saveFailed":
    "Не удалось сохранить конспект: {error} Текст не потерян; при следующем изменении будет новая попытка.",

  "details.title": "Сведения",
  "details.status": "Состояние",
  "details.notSaved": "Ещё не сохранён",
  "details.created": "Создана",
  "details.edited": "Изменена",
  "details.author": "Автор",
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
  "details.removeTag": "Убрать {tag}",
  "details.cover": "Обложка",
  "details.frontmatter": "Frontmatter",
  "details.unreadable": "Не читается",
  "details.file": "Файл",
  "details.actions": "Действия с конспектом",
  "details.properties": "Свойства",
  "details.export": "Экспорт…",
  "details.download": "Скачать .md",
  "details.openExternally": "Открыть во внешнем редакторе",
  "details.reveal": "Показать в Finder",
  "details.delete": "Удалить",
  "details.deleteTitle": "Удалить конспект?",
  "details.confirmDelete": "Конспект «{title}» будет удалён. Это нельзя отменить.",
  "details.confirmDeleteFile": "Конспект «{title}» будет перемещён в корзину системы.",
  "details.deleteFailed": "Не удалось удалить конспект: {error}",

  "list.notes": "Конспекты",
  "list.searchResults": "Результаты поиска",
  "list.loadFailed": "Не удалось загрузить конспекты",
  "list.searchFailed": "Поиск не удался",
  "list.noMatches": "Подходящих конспектов нет",
  "list.tagFilters": "Фильтры по тегам",
  "list.removeTag": "Убрать фильтр #{tag}",
  "list.unreadable":
    "Некоторые сохранённые конспекты не удалось прочитать. Они сохранены; см. {link}.",
  "list.unreadableLink": "Настройки → Резервные копии и восстановление",
  "welcome.title": "Добро пожаловать в Konspecter",
  "welcome.text":
    "Ваши конспекты в обычном Markdown: хранятся на этом устройстве и работают без сети. Отмечайте их {tags} где угодно, находите полнотекстовым поиском и синхронизируйте с сервером, когда захотите.",
  "welcome.create": "Создать первый конспект",
  "welcome.example": "Добавить пример конспекта",
  "welcome.import":
    "Уже есть конспекты? Импортируйте файлы {md} или папку в {settings}, там же подключается синхронизация.",
  "welcome.exampleNote": `# Добро пожаловать в Konspecter

Каждый конспект — это документ **Markdown**. Этот показывает, что это даёт.

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
исходный текст, или удалите этот конспект, когда закончите.
`,

  "editor.loadFailed": "Не удалось загрузить редактор",
  "editor.readerLoadFailed": "Не удалось загрузить просмотр конспекта",
  "editor.textUnavailable":
    "Текстовое редактирование недоступно: {reason} Исправьте это в Markdown ниже.",
  "editor.markdownOnly": "{reason}, поэтому его можно редактировать только в режиме Markdown.",
  "editor.uses": "В этом конспекте есть {features}",
  "editor.wouldChange": "В этом конспекте есть Markdown, который текстовый редактор изменил бы",
  "editor.feature.tables": "таблицы",
  "editor.feature.strikethrough": "зачёркивание",
  "editor.feature.html": "HTML",
  "editor.feature.footnotes": "сноски",
  "editor.text": "Текст конспекта",
  "editor.source": "Markdown",
  "editor.placeholder": "Начните писать…",
  "editor.sourcePlaceholder": "# Заголовок",
  "editor.title": "Заголовок",
  "editor.author": "Автор",
  "editor.cover": "Обложка",
  "editor.coverUpload": "Загрузить…",
  "editor.coverReplace": "Заменить…",
  "editor.coverRemove": "Убрать",
  "editor.coverUploadFailed":
    "Этот файл нельзя сделать обложкой. Выберите изображение PNG, JPEG, GIF или WebP.",
  "editor.coverUploaded": "Загруженное изображение, {size}",
  "editor.formatting": "Форматирование",
  "editor.allTools": "Все инструменты форматирования",
  "editor.showTools": "Показать все инструменты форматирования",
  "editor.foldTools": "Свернуть панель",
  "editor.linkAddress": "Адрес ссылки",
  "editor.openLink": "Открыть {address}",
  "editor.openLinkHint": "Открыть ссылку в браузере",
  "editor.taskDone": "Сделано",
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
  "settings.group.appearance": "Внешний вид",
  "settings.group.writing": "Письмо и чтение",
  "settings.group.files": "Конспекты и файлы",
  "settings.group.app": "Приложение",
  "settings.theme": "Тема",
  "settings.theme.system": "Как в системе",
  "settings.theme.light": "Светлая",
  "settings.theme.dark": "Тёмная",
  "settings.language": "Язык",
  "settings.language.system": "Как в системе",
  "settings.editor": "Редактор по умолчанию",
  "settings.editor.hint":
    "Конспекты, которые текстовый редактор не может показать, всегда открываются в Markdown.",
  "settings.editor.text": "Текст",
  "settings.editor.markdown": "Markdown",
  "settings.editingArea": "Область редактирования",
  "settings.editingArea.hint":
    "Чуть более тёмная панель с полями по бокам показывает, где редактируется конспект.",
  "settings.editingArea.highlighted": "Выделена",
  "settings.editingArea.plain": "Без выделения",
  "settings.textSize": "Размер текста",
  "settings.textSize.small": "Мелкий",
  "settings.textSize.default": "Обычный",
  "settings.textSize.large": "Крупный",
  "settings.textSize.larger": "Крупнее",
  "settings.tagNames": "Названия тегов",
  "settings.tagNames.hint": "Как теги называются на боковой панели.",
  "settings.tagNames.capitalized": "С заглавной буквы",
  "settings.tagNames.asWritten": "Как написано в конспектах",
  "settings.reading": "Место чтения",
  "settings.reading.restore": "Продолжать, где остановился",
  "settings.reading.ask": "Спрашивать перед переходом",
  "settings.reading.off": "Всегда начинать сначала",
  "settings.fileNames": "Имена файлов",
  "settings.fileNames.hint":
    "Файлы новых конспектов называются по заголовку, например hello-mir.md для «Hello мир!».",
  "settings.fileNames.kept": "Оставлять имя при смене заголовка",
  "settings.fileNames.title": "Переименовывать файл по заголовку",
  "settings.saveFailed": "Не удалось сохранить настройки: {error} Они действуют до перезагрузки.",
  "settings.shortcuts": "Сочетания клавиш",
  "settings.storage": "Хранение без сети",
  "settings.storage.persistent":
    "Конспекты надёжно хранятся на этом устройстве и работают без сети.",
  "settings.storage.bestEffort":
    "Конспекты работают без сети, но браузер может удалить их, если на устройстве кончится место.",
  "settings.storage.unsupported":
    "Этот браузер не сообщает, может ли он удалить сохранённые конспекты.",
  "settings.storage.keep": "Хранить конспекты на этом устройстве",
  "settings.about": "О программе",
  "settings.about.text":
    "{name} {version} для {os}. Конспекты хранятся в локальной базе данных приложения.",
  "settings.about.unavailable": "Сведения о приложении недоступны.",
  "settings.library": "Библиотека",
  "settings.library.none":
    "Konspecter хранит каждый конспект файлом {md} в папке, но не смог открыть её. Выберите папку для работы.",
  "settings.library.open": "Выбрать папку…",
  "settings.library.change": "Сменить папку…",
  "settings.library.folder":
    "Каждый конспект — файл Markdown в папке {folder}: его откроет любой файловый менеджер или редактор. Изменения сохраняются в файлы; удалённые конспекты попадают в корзину системы.",
  "settings.library.folderSync":
    "Синхронизация охватывает эту папку: конспекты с других устройств записываются сюда файлами, а файлы, изменённые здесь — в Konspecter или в другой программе, — уходят на них. Если конспект правят в двух местах, побеждает более поздняя правка.",
  "settings.library.folders":
    "Папки следуют за тегами: конспект лежит в папке своего первого тега, #java#collections — это java/collections/.",
  "settings.library.reformat": "Переупорядочить папку…",
  "settings.library.nothingToReformat": "Все конспекты с тегами уже лежат в папках своих тегов.",
  "settings.library.reformatted": {
    one: "{count} конспект перенесён в папку своих тегов.",
    few: "{count} конспекта перенесены в папки своих тегов.",
    many: "{count} конспектов перенесены в папки своих тегов.",
    other: "{count} конспекта перенесены в папки своих тегов.",
  },
  "reformat.title": "Переупорядочить локальную коллекцию файлов?",
  "reformat.message": {
    one: "Konspecter хранит каждый конспект в папке его первого тега, так что папки повторяют дерево тегов: #java#collections — это java/collections/. {count} конспект с тегами лежит в другом месте и будет перенесён в папку своих тегов. Конспекты без тегов останутся на месте.",
    few: "Konspecter хранит каждый конспект в папке его первого тега, так что папки повторяют дерево тегов: #java#collections — это java/collections/. {count} конспекта с тегами лежат в другом месте и будут перенесены в папки своих тегов. Конспекты без тегов останутся на месте.",
    many: "Konspecter хранит каждый конспект в папке его первого тега, так что папки повторяют дерево тегов: #java#collections — это java/collections/. {count} конспектов с тегами лежат в другом месте и будут перенесены в папки своих тегов. Конспекты без тегов останутся на месте.",
    other:
      "Konspecter хранит каждый конспект в папке его первого тега, так что папки повторяют дерево тегов: #java#collections — это java/collections/. {count} конспекта с тегами лежат в другом месте и будут перенесены в папки своих тегов. Конспекты без тегов останутся на месте.",
  },
  "reformat.confirm": "Переупорядочить",
  "reformat.keep": "Оставить как есть",

  "backup.title": "Резервные копии и восстановление",
  "backup.hint":
    "Для резервной копии экспортируйте все конспекты: это обычные файлы Markdown, им больше ничего не нужно. Индексы тегов и поиска строятся из конспектов и всегда могут быть перестроены.",
  "backup.rebuild": "Перестроить индексы",
  "backup.rebuilt": {
    one: "Индексы перестроены по {count} конспекту.",
    few: "Индексы перестроены по {count} конспектам.",
    many: "Индексы перестроены по {count} конспектам.",
    other: "Индексы перестроены по {count} конспекта.",
  },
  "backup.unreadable": {
    one: "{count} сохранённую запись не удалось прочитать как конспект. Она оставлена как есть. Скачайте её, чтобы изучить или восстановить вручную, затем удалите.",
    few: "{count} сохранённые записи не удалось прочитать как конспекты. Они оставлены как есть. Скачайте их, чтобы изучить или восстановить вручную, затем удалите.",
    many: "{count} сохранённых записей не удалось прочитать как конспекты. Они оставлены как есть. Скачайте их, чтобы изучить или восстановить вручную, затем удалите.",
    other:
      "{count} сохранённой записи не удалось прочитать как конспекты. Они оставлены как есть. Скачайте их, чтобы изучить или восстановить вручную, затем удалите.",
  },
  "backup.download": "Скачать их (.json)",
  "backup.remove": "Удалить их",
  "backup.downloadFirst": "Сначала скачайте их",
  "backup.removed": "Нечитаемые записи удалены.",

  "reset.title": "Сброс до заводских настроек",
  "reset.hint":
    "Возвращает Konspecter к состоянию сразу после установки: стираются настройки, подключение к синхронизации, позиции чтения и библиотека приложения. Markdown-файлы не затрагиваются, в том числе папка приложения для компьютера.",
  "reset.start": "Сбросить Konspecter…",
  "reset.confirmTitle": "Сбросить Konspecter?",
  "reset.confirm": {
    one: "Будет стёрт {count} конспект из библиотеки приложения, а также настройки, подключение к синхронизации и позиции чтения. Синхронизированные конспекты остаются в вашем аккаунте и вернутся после нового подключения; чтобы сохранить копию, сначала экспортируйте их. Markdown-файлы вне приложения не затрагиваются.",
    few: "Будут стёрты {count} конспекта из библиотеки приложения, а также настройки, подключение к синхронизации и позиции чтения. Синхронизированные конспекты остаются в вашем аккаунте и вернутся после нового подключения; чтобы сохранить копию, сначала экспортируйте их. Markdown-файлы вне приложения не затрагиваются.",
    many: "Будут стёрты {count} конспектов из библиотеки приложения, а также настройки, подключение к синхронизации и позиции чтения. Синхронизированные конспекты остаются в вашем аккаунте и вернутся после нового подключения; чтобы сохранить копию, сначала экспортируйте их. Markdown-файлы вне приложения не затрагиваются.",
    other:
      "Будут стёрты {count} конспекта из библиотеки приложения, а также настройки, подключение к синхронизации и позиции чтения. Синхронизированные конспекты остаются в вашем аккаунте и вернутся после нового подключения; чтобы сохранить копию, сначала экспортируйте их. Markdown-файлы вне приложения не затрагиваются.",
  },
  "reset.confirmEmpty":
    "Будут стёрты настройки, подключение к синхронизации и позиции чтения. Markdown-файлы не затрагиваются, в том числе папка приложения для компьютера.",
  "reset.confirmButton": "Стереть и сбросить",
  "reset.resetting": "Сброс…",

  "ignore.title": "Игнорируемые файлы",
  "ignore.app":
    "Что пропускает импорт папки. Файлы, выбранные по одному, импортируются как выбраны.",
  "ignore.folder":
    "Что Konspecter пропускает в этой папке: не читает, не отслеживает и не создаёт там конспектов. Хранится в папке как {file}, поэтому его видят и другие программы.",
  "ignore.syntax":
    "Пишется как .gitignore: по шаблону на строку, {hidden} — скрытые файлы и папки, {negate} возвращает файл, {comment} — комментарий.",
  "ignore.label": "Правила ({file})",
  "ignore.save": "Сохранить",
  "ignore.default": "Вернуть по умолчанию",
  "ignore.saved": "Сохранено.",

  "transfer.title": "Импорт и экспорт",
  "transfer.hint":
    "Конспекты — это обычный Markdown: импорт сохраняет файлы как есть, а экспорт даёт те же файлы {md}, которые читаются и без Konspecter.",
  "transfer.importFiles": "Импортировать файлы .md…",
  "transfer.importFolder": "Импортировать папку…",
  "transfer.exportFolder": "Экспортировать всё в папку…",
  "transfer.exportZip": "Экспортировать всё (.zip)",
  "transfer.imported": {
    one: "Импортирован {count} конспект",
    few: "Импортированы {count} конспекта",
    many: "Импортировано {count} конспектов",
    other: "Импортировано {count} конспекта",
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
  "transfer.nothing": "Экспортировать нечего: конспектов нет.",
  "transfer.exportedTo": {
    one: "{count} конспект экспортирован в {folder}.",
    few: "{count} конспекта экспортированы в {folder}.",
    many: "{count} конспектов экспортировано в {folder}.",
    other: "{count} конспекта экспортировано в {folder}.",
  },
  "transfer.exportedZip": {
    one: "{count} конспект экспортирован в {file}.",
    few: "{count} конспекта экспортированы в {file}.",
    many: "{count} конспектов экспортировано в {file}.",
    other: "{count} конспекта экспортировано в {file}.",
  },

  "sync.title": "Синхронизация",
  "sync.state.disabled": "Не подключено",
  "sync.state.idle": "Всё синхронизировано",
  "sync.state.syncing": "Синхронизация…",
  "sync.state.offline": "Нет связи — изменения сохранены и будут отправлены, когда связь появится",
  "sync.state.error": "Ошибка синхронизации; повторяю",
  "sync.state.disconnected": "Отключено",
  "sync.state.locked": "Заблокировано",
  "sync.state.unpaid": "Приостановлено",
  "sync.paused": "Синхронизация приостановлена: подписка закончилась.",
  "sync.unpaid": "Синхронизация на этом сервере работает по подписке.",
  "sync.unpaidKept":
    "Все конспекты в сохранности — на этом устройстве и на сервере. Синхронизация продолжится сама, когда будет оплачена.",
  "sync.unpaidPending": {
    one: "Все конспекты в сохранности — на этом устройстве и на сервере; {count} изменение будет отправлено, когда синхронизация будет оплачена.",
    few: "Все конспекты в сохранности — на этом устройстве и на сервере; {count} изменения будут отправлены, когда синхронизация будет оплачена.",
    many: "Все конспекты в сохранности — на этом устройстве и на сервере; {count} изменений будут отправлены, когда синхронизация будет оплачена.",
    other:
      "Все конспекты в сохранности — на этом устройстве и на сервере; {count} изменения будут отправлены, когда синхронизация будет оплачена.",
  },
  "sync.subscribe": "Оформить подписку",
  "sync.checkAgain": "Проверить снова",
  "sync.manageSubscription": "Управлять подпиской",
  "sync.access.trialing": "Пробный период до {date}.",
  "sync.access.active": "Подписка продлевается автоматически.",
  "sync.access.canceled": "Подписка не продлевается. Синхронизация работает до {date}.",
  "sync.access.past_due": "Последний платёж не прошёл. Синхронизация работает до {date}.",
  "sync.lockedSetup":
    "Конспекты шифруются до того, как покинут устройство, а для этого аккаунта шифрование ещё не настроено. Настройте его на сайте и вернитесь сюда.",
  "sync.lockedUnlock":
    "Введите пароль шифрования, чтобы разблокировать синхронизацию на этом устройстве. Им конспекты шифруются до того, как покинут устройство.",
  "sync.openEncryptionSettings": "Открыть настройки шифрования",
  "sync.passphrase": "Пароль шифрования",
  "sync.unlock": "Разблокировать",
  "sync.unlocking": "Разблокирую…",
  "sync.wrongPassphrase":
    "Этот пароль не открывает ключ аккаунта. Проверьте его и попробуйте снова.",
  "sync.unlockFailed": "Не удалось разблокировать: {error}",
  "sync.forgotPassphrase": "Забыли пароль? Задайте новый на сайте с помощью ключа восстановления.",
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
    "Сервер не принял эти конспекты (например, один слишком большой). Они остаются на этом устройстве.",
  "sync.now": "Синхронизировать",
  "sync.disconnect": "Отключиться",
  "sync.intro":
    "Конспекты в любом случае остаются на этом устройстве. Подключение синхронизирует их с вашим аккаунтом на сервере Konspecter.",
  "sync.signInWithBrowser": "Войти через браузер",
  "sync.enterCode": "Подтвердите этот код на странице, которая открылась в браузере:",
  "sync.waitingForApproval": "Жду подтверждения…",
  "sync.openPageAgain": "Открыть страницу снова",
  "sync.cancel": "Отмена",
  "sync.browserDenied": "Запрос отклонён на сайте. Ничего не подключено.",
  "sync.browserExpired": "Код истёк, так и не подтверждённый. Войдите снова, чтобы получить новый.",
  "sync.browserUnavailable":
    "Этот сервер не поддерживает вход через браузер. Используйте токен доступа в разделе «Дополнительно».",
  "sync.scanQr": "Сканировать QR-код",
  "sync.scanTitle": "Отсканируйте QR-код",
  "sync.scanHint":
    "На сайте Konspecter откройте «Настройки аккаунта», выберите «Показать QR-код» и наведите на него камеру.",
  "sync.scanOther":
    "Это не код подключения Konspecter. Используйте код из настроек аккаунта на сайте.",
  "sync.cameraDenied":
    "Konspecter не может пользоваться камерой. Разрешите доступ в настройках системы или вставьте ссылку с сайта.",
  "sync.cameraUnavailable": "Не удалось включить камеру. Вставьте ссылку с сайта.",
  "sync.connecting": "Подключение…",
  "sync.scanAgain": "Сканировать снова",
  "sync.linkSummary": "Подключиться по ссылке с сайта",
  "sync.linkHint":
    "На сайте Konspecter откройте «Настройки аккаунта», выберите «Показать QR-код» и скопируйте ссылку под ним.",
  "sync.link": "Ссылка для подключения",
  "sync.linkConnect": "Подключиться по ссылке",
  "sync.linkInvalid": "Это не ссылка для подключения. Скопируйте её с сайта ещё раз.",
  "sync.invalidConnectCode": "Код неверный, уже использован или истёк. Покажите новый на сайте.",
  "sync.advanced": "Дополнительно: подключиться по токену доступа",
  "sync.tokenHint": "Токен, который выдал администратор сервера (server create-token).",
  "sync.disconnectedBySite":
    "Это устройство отключено от {account} на {server}. Синхронизация остановлена.",
  "sync.disconnectedByServer":
    "{server} больше не принимает это устройство для {account}. Возможно, аккаунт удалён. Синхронизация остановлена.",
  "sync.disconnectedKept": "Все конспекты остаются на этом устройстве.",
  "sync.disconnectedPending": {
    one: "Все конспекты остаются на этом устройстве; {count} изменение будет отправлено, когда вы снова войдёте.",
    few: "Все конспекты остаются на этом устройстве; {count} изменения будут отправлены, когда вы снова войдёте.",
    many: "Все конспекты остаются на этом устройстве; {count} изменений будут отправлены, когда вы снова войдёте.",
    other:
      "Все конспекты остаются на этом устройстве; {count} изменения будут отправлены, когда вы снова войдёте.",
  },
  "sync.signInAgain": "Войти снова",
  "sync.forget": "Остановить синхронизацию",
  "sync.serverUrl": "Адрес сервера",
  "sync.token": "Токен доступа",
  "sync.connectFailed": "Не удалось подключиться: {error}",
  "sync.connect": "Подключиться",
};
