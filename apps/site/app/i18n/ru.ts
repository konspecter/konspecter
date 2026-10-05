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
  "site.settings": "Настройки аккаунта",

  "settings.title": "Настройки",
  "settings.lead": "Вы вошли как {email}.",
  "settings.leadNamed": "Здравствуйте, {name}. Вы вошли как {email}.",
  "settings.name.title": "Ваше имя",
  "settings.name.label": "Имя",
  "settings.name.hint":
    "Им мы приветствуем вас на этой странице. Оставьте пустым — будет видна почта.",
  "settings.name.save": "Сохранить имя",
  "settings.name.saved": "Имя сохранено.",
  "settings.devices.title": "Подключённые устройства",
  "settings.devices.lead":
    "Приложения, которые синхронизируются с этим аккаунтом. Отключённое устройство перестаёт синхронизироваться и сохраняет свои конспекты.",
  "settings.devices.empty":
    "Устройств пока нет. В приложении откройте «Настройки», затем «Синхронизация», и выберите «Войти через браузер».",
  "settings.devices.failed":
    "Не удалось загрузить устройства. Обновите страницу, чтобы попробовать снова.",
  "settings.devices.platformVersion": "{platform}, версия {version}",
  "settings.devices.lastSynced": "Синхронизировано {when}",
  "settings.devices.lastActive": "Было активно {when}",
  "settings.devices.connected": "Подключено {when}",
  "settings.devices.disconnect": "Отключить",
  "settings.devices.disconnectNamed": "Отключить {name}",
  "settings.devices.disconnected":
    "{name} отключено. Конспекты остаются на устройстве, синхронизация остановлена.",
  "settings.delete.title": "Удаление аккаунта",
  "settings.delete.lead":
    "Аккаунт удаляется вместе со всеми конспектами, которые он хранит на сервере, а все устройства отключаются. Конспекты на ваших устройствах остаются. Отменить это нельзя.",
  "settings.delete.label": "Введите {email} для подтверждения",
  "settings.delete.submit": "Удалить аккаунт",
  "settings.delete.signInAgain":
    "Чтобы удалить аккаунт, сначала войдите заново. Так мы убедимся, что это вы, а не браузер, в котором кто-то забыл выйти.",
  "settings.delete.signInAgainButton": "Войти заново",

  "encryption.title": "Шифрование",
  "encryption.lead":
    "Конспекты шифруются на ваших устройствах до синхронизации ключом, который открывает только ваш пароль шифрования. Сервер хранит шифротекст и прочитать его не может.",
  "encryption.loading": "Проверяем шифрование…",
  "encryption.needsScript": "Настройки шифрования работают в браузере, для них нужен JavaScript.",
  "encryption.offLead":
    "Шифрование ещё не настроено, поэтому ничего не синхронизируется. Выберите пароль шифрования: его нужно будет один раз ввести на каждом устройстве. Это не пароль от аккаунта, и сбросить его за вас мы не сможем.",
  "encryption.newPassphrase": "Новый пароль шифрования",
  "encryption.repeatPassphrase": "Повторите пароль",
  "encryption.passphraseHint":
    "Не короче {count} символов. Хорошо подходят несколько несвязанных слов.",
  "encryption.setUp": "Настроить шифрование",
  "encryption.recoveryLead":
    "Это ваш ключ восстановления. Если вы забудете пароль, только с ним можно задать новый. Запишите его или сохраните в менеджере паролей: он показывается только сейчас.",
  "encryption.recoveryKey": "Ключ восстановления",
  "encryption.copy": "Скопировать",
  "encryption.copied": "Скопировано",
  "encryption.confirmRecovery": "Введите ключ восстановления, чтобы подтвердить, что сохранили его",
  "encryption.finishSetUp": "Завершить настройку",
  "encryption.setUpDone":
    "Шифрование настроено. Разблокируйте синхронизацию в каждом приложении своим паролем.",
  "encryption.onLead": "Шифрование включено с {date}.",
  "encryption.change": "Сменить пароль шифрования",
  "encryption.currentPassphrase": "Текущий пароль",
  "encryption.changeSubmit": "Сменить пароль",
  "encryption.changed":
    "Пароль сменён. Уже разблокированные устройства продолжают синхронизацию; новым нужен новый пароль.",
  "encryption.recover": "Забыли пароль?",
  "encryption.recoverLead": "Задайте новый пароль с помощью ключа восстановления.",
  "encryption.recoverSubmit": "Задать новый пароль",
  "encryption.reset": "Сбросить шифрование",
  "encryption.resetLead":
    "Если потеряны и пароль, и ключ восстановления: ключ и все конспекты на сервере удаляются. Устройства сохраняют свои конспекты и загрузят их снова, когда вы настроите шифрование заново и разблокируете их.",
  "encryption.resetConfirm": "Я понимаю, что конспекты на сервере будут удалены.",
  "encryption.resetSubmit": "Удалить копии на сервере и сбросить",
  "encryption.resetDone":
    "Шифрование сброшено, конспекты на сервере удалены. Настройте его снова, чтобы синхронизироваться.",
  "encryption.error.short": "Возьмите пароль подлиннее.",
  "encryption.error.mismatch": "Пароли не совпадают.",
  "encryption.error.recoveryMismatch":
    "Это не тот ключ восстановления, что показан выше. Проверьте его по буквам.",
  "encryption.error.wrongCurrent": "Текущий пароль неверный.",
  "encryption.error.wrongRecovery": "Этот ключ восстановления не открывает ключ аккаунта.",
  "encryption.error.conflict":
    "Шифрование изменили в другом окне или на другом устройстве. Обновите страницу и попробуйте снова.",
  "encryption.error.gone": "Шифрование тем временем сбросили. Обновите страницу.",
  "encryption.error.signedOut": "Вы вышли из аккаунта. Войдите снова и повторите.",
  "encryption.error.network": "Сервер недоступен. Проверьте подключение и повторите.",
  "encryption.error.failed": "На сервере что-то пошло не так. Попробуйте ещё раз чуть позже.",

  "device.platform.web": "Браузер",
  "device.platform.macos": "macOS",
  "device.platform.windows": "Windows",
  "device.platform.linux": "Linux",
  "device.platform.android": "Android",
  "device.platform.ios": "iOS",
  "device.platform.other": "Другое",

  "activate.title": "Подключение устройства",
  "activate.lead":
    "Приложение просит доступ к синхронизации с {email}. Проверьте, что код совпадает с кодом в приложении.",
  "activate.codeLabelled": "Код {code}",
  "activate.warning":
    "Подтверждайте, только если вы сами начали подключение на своём устройстве. Подключённое приложение может читать и менять все синхронизируемые конспекты.",
  "activate.approve": "Подтвердить",
  "activate.deny": "Отклонить",
  "activate.enterLead": "Введите код, который показывает приложение.",
  "activate.codeLabel": "Код из приложения",
  "activate.continue": "Продолжить",
  "activate.approvedTitle": "Устройство подключено",
  "activate.approved":
    "{name} теперь синхронизируется с вашим аккаунтом. Вернитесь в приложение: дальше оно справится само.",
  "activate.toSettings": "Посмотреть подключённые устройства",
  "activate.deniedTitle": "Запрос отклонён",
  "activate.denied":
    "Ничего не подключено. Если подключение начинали не вы, просто ничего не делайте: код скоро истечёт.",

  "auth.email": "Почта",
  "auth.password": "Пароль",
  "auth.newPassword": "Новый пароль",
  "auth.passwordHint": "Не меньше 8 символов.",
  "auth.working": "Минутку…",

  "providers.label": "Вход через другие сервисы",
  "providers.or": "или по почте",
  "provider.google": "Войти через Google",
  "provider.linkedin": "Войти через LinkedIn",
  "provider.x": "Войти через X",
  "provider.yandex": "Войти с Яндекс ID",
  "provider.vk": "Войти с VK ID",
  "providerName.google": "Google",
  "providerName.linkedin": "LinkedIn",
  "providerName.x": "X",
  "providerName.yandex": "Яндекс ID",
  "providerName.vk": "VK ID",

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
  "code.leadComplete":
    "Мы отправили 6-значный код на {email}. Введите его, чтобы подтвердить адрес и завершить вход; код действует недолго.",
  "code.label": "Код",
  "code.submit": "Продолжить",
  "code.resend": "Прислать новый код",
  "code.resent": "Новый код уже в пути.",
  "code.otherEmail": "Указать другую почту",
  "code.startOver": "Начать заново",

  "complete.title": "Подтвердите почту",
  "complete.lead":
    "От {provider} не пришёл подтверждённый адрес почты. Укажите свой, и мы пришлём код для проверки. Если у вас уже есть аккаунт с этим адресом, вход через {provider} добавится к нему.",
  "complete.submit": "Прислать код",
  "complete.cancel": "Войти другим способом",

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
  "authError.oauth_failed":
    "Не удалось войти через этот сервис. Попробуйте ещё раз или войдите по почте.",
  "authError.oauth_cancelled": "Вход отменён. Попробуйте ещё раз или войдите по почте.",
  "authError.provider_unavailable": "Этот способ входа на сервере не настроен.",
  "authError.identity_expired": "Вход занял слишком много времени. Начните заново.",
  "authError.invalid_name": "Имя — не длиннее 100 символов и без переносов строк.",
  "authError.email_mismatch": "Это не почта этого аккаунта. Введите её точно, чтобы подтвердить.",
  "authError.reauthentication_required": "Перед удалением аккаунта войдите заново.",
  "authError.invalid_user_code":
    "Ни одно устройство не ждёт этот код. Проверьте его или начните заново в приложении.",
  "authError.unknown": "На сервере что-то пошло не так. Попробуйте чуть позже.",

  "error.title": "Страница не найдена",
  "error.notFound": "По этому адресу страницы нет.",
  "error.failed": "Не удалось показать страницу. Попробуйте ещё раз чуть позже.",
  "error.home": "На главную",
};
