import type { Dictionary } from "./i18n";

/** Russian. Plural forms: one (1, 21), few (2–4), many (0, 5–20), other (fractions). */
export const ru: Dictionary = {
  "site.title": "Konspecter",
  "site.description":
    "Блокнот для технических конспектов: обычные файлы Markdown, работа без сети, на компьютере, телефоне и в браузере.",
  "site.skipToContent": "Перейти к содержимому",
  "site.home": "Главная Konspecter",
  "site.otherLanguage": "English",
  "site.otherLanguageHint": "Read in English",
  "site.toLight": "Включить светлую тему",
  "site.toDark": "Включить тёмную тему",
  "site.footer": "Konspecter хранит технические конспекты в Markdown.",

  "home.title": "Технические конспекты в обычном Markdown",
  "home.lead":
    "Konspecter — блокнот для того, что вы узнаёте в работе: команд, запросов, решений и их причин. Каждый конспект — файл Markdown: он открывается сразу и работает без сети.",
  "home.specimenLabel": "Конспект в том виде, в каком его хранит Konspecter",
  "home.download": "Скачать для {platform}",
  "home.openWeb": "Открыть в браузере",
  "home.featuresTitle": "Что он умеет",
  "home.feature.markdown.title": "Файл и есть конспект",
  "home.feature.markdown.text":
    "Заголовок, даты и теги — в коротком заголовке в начале Markdown. Больше нигде ничего не хранится, поэтому заметки прочитает любой редактор.",
  "home.feature.editors.title": "Текст или исходник — одна клавиша",
  "home.feature.editors.text":
    "Пишите в чистом текстовом редакторе или переключитесь на исходный Markdown, когда он нужен. Курсор останется там, где был.",
  "home.feature.tags.title": "Вложенные теги",
  "home.feature.tags.text":
    "Напишите в тексте #databases#postgres, и конспект появится под обоими тегами в дереве. Никаких папок, за порядком в которых надо следить.",
  "home.feature.search.title": "Поиск успевает за вами",
  "home.feature.search.text":
    "Полнотекстовый поиск с фильтром по тегам отвечает по мере ввода — по всем конспектам на устройстве, с сетью или без.",
  "home.feature.folders.title": "Папка файлов .md",
  "home.feature.folders.text":
    "Приложение для компьютера работает в любой папке с файлами Markdown, так что Git, Obsidian или ваш редактор продолжают работать рядом.",
  "home.feature.sync.title": "Синхронизация, которую сервер не прочтёт",
  "home.feature.sync.text":
    "Подключите устройства к аккаунту, и конспекты будут шифроваться на каждом устройстве перед отправкой. Сервер хранит только шифротекст.",
  "home.downloadsTitle": "Установить Konspecter",
  "home.downloadsLead": "Одно приложение на всех платформах, с теми же файлами.",
  "home.platform.macos": "macOS",
  "home.platform.windows": "Windows",
  "home.platform.linux": "Linux",
  "home.platform.android": "Android",
  "home.platform.web": "Веб",
  "home.platformNote.macos": "Apple silicon и Intel",
  "home.platformNote.windows": "Windows 10 и новее",
  "home.platformNote.linux": "AppImage и .deb",
  "home.platformNote.android": "Android 7 и новее",
  "home.platformNote.web": "Любой современный браузер, можно установить как приложение",
  "home.get": "Скачать",
  "home.open": "Открыть",

  "site.signIn": "Войти",
  "site.signOut": "Выйти",
  "site.account": "Аккаунт",

  "auth.email": "Почта",
  "auth.password": "Пароль",
  "auth.newPassword": "Новый пароль",
  "auth.passwordHint": "Не меньше 8 символов.",
  "auth.working": "Минутку…",

  "login.title": "Вход",
  "login.lead":
    "Войдите с паролем или получите одноразовый код на почту. Если аккаунта ещё нет, код его создаст.",
  "login.submit": "Войти",
  "login.sendCode": "Прислать код на почту",
  "login.forgot": "Забыли пароль?",
  "login.noAccount": "Ещё нет аккаунта?",
  "login.register": "Создать",

  "register.title": "Создание аккаунта",
  "register.lead": "Мы пришлём на почту код, чтобы подтвердить адрес.",
  "register.submit": "Создать аккаунт",
  "register.haveAccount": "Уже есть аккаунт?",
  "register.signIn": "Войти",
  "register.noPassword": "Не хотите хранить пароль? {link}: он тоже создаст аккаунт.",
  "register.codeLink": "Войдите по коду из письма",

  "code.title": "Проверьте почту",
  "code.lead": "Мы отправили 6-значный код на {email}. Введите его здесь; код действует недолго.",
  "code.leadRegister":
    "Мы отправили 6-значный код на {email}. Введите его здесь, чтобы создать аккаунт; код действует недолго.",
  "code.label": "Код",
  "code.submit": "Продолжить",
  "code.resend": "Прислать новый код",
  "code.resent": "Новый код уже в пути.",
  "code.otherEmail": "Указать другую почту",
  "code.startOver": "Начать заново",

  "forgot.title": "Забыли пароль?",
  "forgot.lead": "Укажите почту, и мы пришлём ссылку, чтобы задать новый пароль.",
  "forgot.submit": "Прислать ссылку",
  "forgot.sent":
    "Мы отправили инструкции на {email}. Откройте ссылку из письма, чтобы задать новый пароль.",
  "forgot.back": "Вернуться ко входу",

  "reset.title": "Новый пароль",
  "reset.lead": "После этого вы выйдете из аккаунта на сайте на всех остальных устройствах.",
  "reset.submit": "Сохранить пароль",
  "reset.missing": "Ссылка неполная. Запросите новую.",
  "reset.requestNew": "Запросить новую ссылку",

  "authError.invalid_credentials": "Неверная почта или пароль.",
  "authError.invalid_email": "Введите правильный адрес почты.",
  "authError.weak_password": "Пароль должен быть не короче 8 символов.",
  "authError.password_required": "Введите пароль или попросите код.",
  "authError.invalid_code":
    "Код неверный или устарел. Проверьте последнее письмо или попросите новый код.",
  "authError.registration_closed": "Этот сервер не принимает новые аккаунты.",
  "authError.invalid_token": "Ссылка неверная, уже использована или устарела. Запросите новую.",
  "authError.rate_limited": "Слишком много попыток. Попробуйте снова через {minutes} мин.",
  "authError.mail": "Не удалось отправить письмо. Попробуйте позже.",
  "authError.not_configured": "Вход на этом сервере не настроен.",
  "authError.unknown": "На сервере что-то пошло не так. Попробуйте чуть позже.",

  "error.title": "Страница не найдена",
  "error.notFound": "По этому адресу страницы нет.",
  "error.failed": "Не удалось показать страницу. Попробуйте ещё раз чуть позже.",
  "error.home": "На главную",
};
